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
import { RAGService } from 'src/rag/rag.service';
import { forwardRef, Inject, Logger } from '@nestjs/common';

interface RecordingUser {
  userId: string;
  isRecording: boolean;
  lastActivity: string;
  socketId: string;
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

  private readonly logger = new Logger(MeetingsGateway.name);
  private userSockets: Map<string, Socket> = new Map();
  private activeMeetings = new Map<string, Set<string>>();
  private userSocketsByEmail = new Map<string, string>();
  private recordingUsers = new Map<string, Map<string, RecordingUser>>();

  constructor(
    @Inject(forwardRef(() => MeetingsService))
    private meetingsService: MeetingsService,
    @Inject(forwardRef(() => TranscriptsService))
    private transcriptsService: TranscriptsService,
    @Inject(forwardRef(() => RAGService))
    private ragService: RAGService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    this.meetingsService.setGateway(this);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.cleanupUserOnDisconnect(client.id);
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(
    @MessageBody() data: { email: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { email } = data;
    this.logger.log(`Registering user ${email} for global updates`);

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

    this.logger.log(`User ${userEmail} joining meeting ${meetingId}`);

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
      client.emit('meeting-joined', { meeting });
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

    this.logger.log(`User ${userEmail} joined meeting ${meetingId}`);
  }

  @SubscribeMessage('leave-meeting')
  async handleLeaveMeeting(
    @MessageBody() data: { meetingId: string; userEmail: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { meetingId, userEmail } = data;

    this.logger.log(`User ${userEmail} leaving meeting ${meetingId}`);

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

    this.logger.log(
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
      this.logger.log(
        `Transcript update for meeting ${meetingId}: ${speakerEmail}`,
      );

      this.transcriptsService.addTranscript(
        meetingId,
        speakerEmail,
        speakerName,
        text,
      );

      const transcriptEntry = {
        speakerName: speakerName,
        speakerEmail: speakerEmail,
        text: text.trim(),
        timestamp: new Date().toISOString(),
        meetingId,
      };

      this.server
        .to(`meeting-${meetingId}`)
        .emit('new-transcript', transcriptEntry);

      this.server.emit('new-transcript', transcriptEntry);
    } catch (error) {
      this.logger.error('Error handling transcript update:', error);
    }
  }

  @SubscribeMessage('ask-question')
  async handleAskQuestion(
    @MessageBody()
    data: {
      meetingId: number;
      question: string;
      userId: string;
      speakerName: string;
      speakerEmail: string;
      tempId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const { meetingId, question, userId, speakerName, speakerEmail, tempId } =
      data;

    try {
      this.logger.log(
        `Question asked by ${userId} in meeting ${meetingId}: "${question}"`,
      );

      client.emit('question-status', {
        meetingId: meetingId.toString(),
        question,
        userId,
        speakerName,
        speakerEmail,
        status: 'asking',
        timestamp: new Date().toISOString(),
        tempId,
      });

      // Process question using RAG
      const ragAnswer = await this.ragService.askQuestion({
        meetingId: meetingId.toString(),
        question,
        userId,
        speakerName,
        speakerEmail,
        timestamp: new Date().toISOString(),
      });

      // Emit answer
      client.emit('question-answered', {
        tempId,
        id: ragAnswer.id,
        meetingId: meetingId.toString(),
        question,
        userId,
        speakerName,
        speakerEmail,
        status: ragAnswer.status,
        timestamp: new Date().toISOString(),
        answer: ragAnswer.answer,
        sources: ragAnswer.sources,
      });

      this.logger.log(
        `Answer generated for question by ${speakerEmail} in meeting ${meetingId}`,
      );
    } catch (error) {
      this.logger.error('Error handling question:', error);

      // Emit error status
      client.emit('question-error', {
        meetingId: meetingId.toString(),
        question,
        userId,
        speakerName,
        speakerEmail,
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message || 'Failed to generate answer',
        sources: [],
      });
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
    this.logger.log(`Broadcasting summary-created for meeting ${meetingId}`);

    const summaryData = {
      meetingId,
      ...summary,
    };

    this.server.to(`meeting-${meetingId}`).emit('summary-created', summaryData);
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
    this.logger.log(
      `Broadcasting transcripts-flushed for meeting ${meetingId}, ${data.transcripts.length} segments`,
    );

    this.server.to(`meeting-${meetingId}`).emit('transcripts-flushed', {
      meetingId,
      ...data,
    });

    this.server.emit('transcripts-flushed', {
      meetingId,
      ...data,
    });
  }

  async broadcastMeetingUpdate(meeting: any, eventType: string) {
    this.logger.log(
      `Broadcasting ${eventType} for meeting ${meeting.id} to ${meeting.participants.length} participants`,
    );

    this.server.to(`meeting-${meeting.id}`).emit(eventType, meeting);
    this.server.emit(eventType, meeting);

    let sentCount = 0;
    meeting.participants.forEach((participantEmail: string) => {
      const socket = this.userSockets.get(participantEmail);
      if (socket && socket.connected) {
        this.logger.log(
          `Sending ${eventType} to participant: ${participantEmail}`,
        );
        socket.emit(eventType, meeting);
        sentCount++;
      }
    });

    this.logger.log(
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
    this.logger.log(`Cleaned up meeting data for ${meetingId}`);
  }
}
