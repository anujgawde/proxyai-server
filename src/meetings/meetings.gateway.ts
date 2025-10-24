import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MeetingsService } from './meetings.service';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { forwardRef, Inject } from '@nestjs/common';

interface RecordingUser {
  userId: string;
  isRecording: boolean;
  lastActivity: string;
  socketId: string;
}

interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  meetingId: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
})
export class MeetingsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private userSockets: Map<string, Socket> = new Map();
  private activeMeetings = new Map<string, Set<string>>();
  private userSocketsByEmail = new Map<string, string>();
  private recordingUsers = new Map<string, Map<string, RecordingUser>>();

  constructor(
    @Inject(forwardRef(() => MeetingsService))
    private meetingsService: MeetingsService,
    @Inject(forwardRef(() => TranscriptsService))
    private transcriptsService: TranscriptsService,
  ) {}

  afterInit(server: Server) {
    console.log('WebSocket Gateway initialized');
    this.meetingsService.setGateway(this);
  }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.cleanupUserOnDisconnect(client.id);
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(
    @MessageBody() data: { email: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { email } = data;
    console.log(`Registering user ${email} for global updates`);

    this.userSockets.set(email, client);
    this.userSocketsByEmail.set(email, client.id);

    client.emit('user-registered', { email });
  }

  @SubscribeMessage('join-meeting')
  async handleJoinMeeting(
    @MessageBody() data: { meetingId: string; userEmail: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { meetingId, userEmail } = data;

    console.log(`User ${userEmail} joining meeting ${meetingId}`);

    this.userSockets.set(userEmail, client);
    this.userSocketsByEmail.set(userEmail, client.id);

    await client.join(`meeting-${meetingId}`);

    if (!this.activeMeetings.has(meetingId)) {
      this.activeMeetings.set(meetingId, new Set());
    }
    this.activeMeetings.get(meetingId)?.add(client.id);

    if (!this.recordingUsers.has(meetingId)) {
      this.recordingUsers.set(meetingId, new Map());
    }

    const meeting = await this.meetingsService.getMeetingById(meetingId);
    if (meeting) {
      client.emit('meeting-joined', {
        meeting,
      });
    }

    const meetingRecordingUsers = this.recordingUsers.get(meetingId);
    if (meetingRecordingUsers) {
      const recordingUsersArray = Array.from(
        meetingRecordingUsers.values(),
      ).filter((user) => user.isRecording);
      client.emit('recording-status-update', recordingUsersArray);
    }

    client
      .to(`meeting-${meetingId}`)
      .emit('user-joined-meeting', { userEmail });

    console.log(`User ${userEmail} joined meeting ${meetingId}`);
  }

  @SubscribeMessage('leave-meeting')
  async handleLeaveMeeting(
    @MessageBody() data: { meetingId: string; userEmail: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { meetingId, userEmail } = data;

    console.log(`User ${userEmail} leaving meeting ${meetingId}`);

    await client.leave(`meeting-${meetingId}`);
    this.cleanupUserFromMeeting(meetingId, userEmail, client.id);

    client.to(`meeting-${meetingId}`).emit('user-left-meeting', { userEmail });
  }

  @SubscribeMessage('update-recording-status')
  handleUpdateRecordingStatus(
    @MessageBody()
    data: {
      meetingId: string;
      userId: string;
      isRecording: boolean;
      timestamp: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const { meetingId, userId, isRecording, timestamp } = data;

    console.log(
      `User ${userId} ${isRecording ? 'started' : 'stopped'} recording in meeting ${meetingId}`,
    );

    if (!this.recordingUsers.has(meetingId)) {
      this.recordingUsers.set(meetingId, new Map());
    }

    const meetingRecordingUsers = this.recordingUsers.get(meetingId);

    if (meetingRecordingUsers) {
      if (isRecording) {
        meetingRecordingUsers.set(userId, {
          userId,
          isRecording: true,
          lastActivity: timestamp,
          socketId: client.id,
        });
      } else {
        const existingUser = meetingRecordingUsers.get(userId);
        if (existingUser) {
          meetingRecordingUsers.set(userId, {
            ...existingUser,
            isRecording: false,
          });
        }
      }

      const eventName = isRecording
        ? 'user-started-recording'
        : 'user-stopped-recording';
      client.to(`meeting-${meetingId}`).emit(eventName, userId);

      const recordingUsersArray = Array.from(
        meetingRecordingUsers.values(),
      ).filter((user) => user.isRecording);

      this.server
        .to(`meeting-${meetingId}`)
        .emit('recording-status-update', recordingUsersArray);
    }
  }

  @SubscribeMessage('transcript-update')
  async handleTranscriptUpdate(
    @MessageBody()
    data: {
      meetingId: string;
      speakerEmail: string;
      speakerName: string;
      text: string;
    },
  ) {
    const { meetingId, speakerEmail, speakerName, text } = data;

    try {
      console.log(
        `Transcript update for meeting ${meetingId}: ${speakerEmail}: ${text.substring(0, 50)}...`,
      );

      // Add to buffer - timeStart and timeEnd will be set by the service
      this.transcriptsService.addTranscript(
        meetingId,
        speakerEmail,
        speakerName,
        text,
      );

      // Create broadcast entry with timestamp for real-time display
      const transcriptEntry = {
        speakerName: speakerName,
        speakerEmail: speakerEmail,
        text: text.trim(),
        timestamp: new Date().toISOString(),
        meetingId,
      };

      // Broadcast to meeting room
      this.server
        .to(`meeting-${meetingId}`)
        .emit('new-transcript', transcriptEntry);

      // Broadcast to all connected clients for dashboard updates
      this.server.emit('new-transcript', transcriptEntry);
    } catch (error) {
      console.error('Error handling transcript update:', error);
    }
  }

  broadcastSummaryCreated(
    meetingId: string,
    summary: {
      id: number;
      content: string;
      createdAt: string;
    },
  ) {
    console.log(`Broadcasting summary-created for meeting ${meetingId}`);

    const summaryData = {
      meetingId,
      ...summary,
    };

    // Broadcast to meeting room
    this.server.to(`meeting-${meetingId}`).emit('summary-created', summaryData);

    // Also broadcast to all clients for dashboard updates
    this.server.emit('summary-created', summaryData);
  }

  broadcastTranscriptsFlushed(
    meetingId: string,
    data: {
      entryId: number;
      transcripts: any[];
      timeStart: string;
      timeEnd: string;
    },
  ) {
    console.log(
      `Broadcasting transcripts-flushed for meeting ${meetingId}, ${data.transcripts.length} segments`,
    );

    // Broadcast to meeting room
    this.server.to(`meeting-${meetingId}`).emit('transcripts-flushed', {
      meetingId,
      ...data,
    });

    // Also broadcast to all clients for dashboard updates
    this.server.emit('transcripts-flushed', {
      meetingId,
      ...data,
    });
  }

  async broadcastMeetingUpdate(meeting: any, eventType: string) {
    console.log(
      `Broadcasting ${eventType} for meeting ${meeting.id} to ${meeting.participants.length} participants`,
    );

    // Broadcast to meeting room
    this.server.to(`meeting-${meeting.id}`).emit(eventType, meeting);

    // ALSO broadcast to all connected clients (for dashboard updates)
    this.server.emit(eventType, meeting);

    // Send directly to each participant
    let sentCount = 0;
    meeting.participants.forEach((participantEmail: string) => {
      const socket = this.userSockets.get(participantEmail);
      if (socket && socket.connected) {
        console.log(`Sending ${eventType} to participant: ${participantEmail}`);
        socket.emit(eventType, meeting);
        sentCount++;
      } else {
        console.log(`Participant ${participantEmail} not connected`);
      }
    });

    console.log(
      `Broadcasted ${eventType} to room, all clients, and ${sentCount}/${meeting.participants.length} participants directly`,
    );
  }

  private cleanupUserOnDisconnect(socketId: string) {
    let userEmailToRemove: string | null = null;

    for (const [userEmail, userSocketId] of this.userSocketsByEmail.entries()) {
      if (userSocketId === socketId) {
        userEmailToRemove = userEmail;
        break;
      }
    }

    if (userEmailToRemove) {
      const currentSocket = this.userSockets.get(userEmailToRemove);
      if (currentSocket && currentSocket.id === socketId) {
        this.userSockets.delete(userEmailToRemove);
        this.userSocketsByEmail.delete(userEmailToRemove);
      }

      for (const [
        meetingId,
        recordingUsersMap,
      ] of this.recordingUsers.entries()) {
        const recordingUser = recordingUsersMap.get(userEmailToRemove);
        if (recordingUser && recordingUser.socketId === socketId) {
          recordingUsersMap.delete(userEmailToRemove);

          this.server
            .to(`meeting-${meetingId}`)
            .emit('user-stopped-recording', userEmailToRemove);

          const recordingUsersArray = Array.from(
            recordingUsersMap.values(),
          ).filter((user) => user.isRecording);
          this.server
            .to(`meeting-${meetingId}`)
            .emit('recording-status-update', recordingUsersArray);
        }
      }
    }

    for (const [meetingId, socketIds] of this.activeMeetings.entries()) {
      if (socketIds.has(socketId)) {
        socketIds.delete(socketId);

        if (socketIds.size === 0) {
          this.cleanupMeeting(meetingId);
        }
        break;
      }
    }
  }

  private cleanupUserFromMeeting(
    meetingId: string,
    userEmail: string,
    socketId: string,
  ) {
    if (this.activeMeetings.has(meetingId)) {
      this.activeMeetings.get(meetingId)?.delete(socketId);
    }

    if (this.recordingUsers.has(meetingId)) {
      const meetingRecordingUsers = this.recordingUsers.get(meetingId);
      if (meetingRecordingUsers) {
        const recordingUser = meetingRecordingUsers.get(userEmail);
        if (recordingUser && recordingUser.socketId === socketId) {
          meetingRecordingUsers.delete(userEmail);

          const recordingUsersArray = Array.from(
            meetingRecordingUsers.values(),
          ).filter((user) => user.isRecording);
          this.server
            .to(`meeting-${meetingId}`)
            .emit('recording-status-update', recordingUsersArray);
        }
      }
    }

    const currentSocket = this.userSockets.get(userEmail);
    if (currentSocket && currentSocket.id === socketId) {
      this.userSockets.delete(userEmail);
      this.userSocketsByEmail.delete(userEmail);
    }
  }

  private cleanupMeeting(meetingId: string) {
    this.activeMeetings.delete(meetingId);
    this.recordingUsers.delete(meetingId);
    console.log(`Cleaned up meeting data for ${meetingId}`);
  }
}
