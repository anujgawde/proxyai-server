# ProxyAI Server

A NestJS backend for real-time meeting transcription, AI-powered Q&A, and calendar integration.

## Features

- **Real-time Transcription** - Ingests and processes live meeting transcripts

- **AI-Powered Q&A** - Ask questions about meetings using RAG (Retrieval-Augmented Generation)

- **Automatic Summaries** - Generates meeting summaries with Google Gemini

- **Calendar Sync** - Google Calendar integration with push notifications

- **Calendar Provider Auth** - Google OAuth support (Zoom, Microsoft planned)

- **Real-time Updates** - Server-Sent Events for live transcript and status updates

## Tech Stack

| Category | Technology |

|----------|------------|

| Framework | NestJS 11 |

| Database | PostgreSQL + TypeORM |

| Vector DB | Qdrant |

| AI/ML | Google Gemini, Xenova Transformers |

| Auth | Firebase Admin |

| Worker Threads | Piscina |

## Prerequisites

- Node.js 18+

- PostgreSQL 12+

- Qdrant instance

- Firebase project

- Google Cloud project (OAuth + Gemini API)

## Installation

```bash

# Install dependencies

npm  install



# Copy environment file

cp  .env.example  .env



# Configure environment variables (see below)



# Run database migrations (if applicable)



# Start development server

npm  run  start:dev

```

## Environment Variables

```env

# Server

PORT=8001

NODE_ENV=development

CLIENT_URL=http://localhost:3000



# PostgreSQL

DATABASE_HOST=localhost

DATABASE_PORT=5432

DATABASE_USERNAME=postgres

DATABASE_PASSWORD=password

DATABASE_NAME=proxyai



# Firebase

FIREBASE_PROJECT_ID=your-project-id

FIREBASE_CLIENT_EMAIL=your-email@firebase.iam.gserviceaccount.com

FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"



# Qdrant

QDRANT_URL=http://localhost:6333

QDRANT_API_KEY=your-api-key



# Google Gemini

GEMINI_API_KEY=your-gemini-key



# Google OAuth

GOOGLE_CLIENT_ID=your-client-id

GOOGLE_CLIENT_SECRET=your-client-secret

GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/google

GOOGLE_CALENDAR_WEBHOOK_URL=https://your-server/webhook/calendar



# Attendee Bot Service

BOT_SERVICE_API_KEY=your-bot-key

BOT_SERVICE_URL=https://app.attendee.dev/api/v1/bots

```

## Project Structure

```

src/

├── auth/ # Firebase authentication

├── meetings/ # Meeting management & Q&A

├── transcripts/ # Transcript buffering & processing

├── rag/ # Vector storage & RAG Q&A

├── gemini/ # Summary generation

├── providers/ # OAuth & calendar integration

├── webhook/ # Bot & calendar webhooks

├── workers/ # Embedding worker threads

├── users/ # User management

├── entities/ # TypeORM entities

└── config/ # Configuration files

```

## API Endpoints

### Meetings

| Method | Endpoint | Description |

|--------|----------|-------------|

| GET | `/meetings` | List meetings by status |

| POST | `/meetings/sync` | Sync meetings from calendar |

| GET | `/meetings/:id/summaries` | Get meeting summaries |

| GET | `/meetings/:id/transcript-segments` | Get transcript segments |

| GET | `/meetings/:id/qa-history` | Get Q&A history |

| POST | `/meetings/:id/ask-question` | Ask a question about a meeting |

| GET | `/meetings/sse` | SSE stream for real-time updates |

### Webhooks

| Method | Endpoint | Description |

|--------|----------|-------------|

| POST | `/webhook/bots` | Bot transcript & state updates |

| POST | `/webhook/calendar` | Google Calendar notifications |

## Architecture

```

Meeting Start

↓

[Webhook: Attendee Bot Joins and Records]

↓

[Webhook: transcript.update]

↓

TranscriptsService (1-minute buffer)

↓

┌─────────────────────────────┐

│ Background Processing │

├─────────────────────────────┤

│ • RAG Vector Storage │ ← Worker Pool (embeddings)

│ • Summary Generation │ ← Gemini API

└─────────────────────────────┘

↓

[SSE] → Frontend Updates

```

## Scripts

```bash

npm  run  start:dev  # Development with hot reload

npm  run  start:prod  # Production mode

npm  run  build  # Compile TypeScript

npm  run  lint  # ESLint

npm  run  test  # Unit tests

npm  run  test:e2e  # End-to-end tests

```

## Database Entities

| Entity | Purpose |

|--------|---------|

| User | Firebase-authenticated users |

| Meeting | Calendar events with bot status |

| TranscriptEntry | Batched transcripts (1-min groups) |

| TranscriptSegment | Individual speaker segments |

| Summary | AI-generated summaries |

| QAEntry | Q&A history with sources |

| Provider | OAuth credentials & watch state |

## Real-time Updates (SSE)

Connect to `/meetings/sse?userId=<userId>` for:

- `connected` - Connection confirmation

- `heartbeat` - Keep-alive (every 15s)

- `meeting_status_update` - Status changes

- `transcript_update` - New transcript segments

- `summary_update` - Generated summaries

## External Integrations

| Service | Purpose | Status |

|---------|---------|--------|

| Google Calendar | Event sync & webhooks | Active |

| Google Gemini | Summaries & Q&A | Active |

| Qdrant | Vector search | Active |

| Firebase | Authentication | Active |

| Attendee Bot | Transcription | Active |

| Zoom | Calendar sync | Planned |

| Microsoft | Calendar sync | Planned |

## Contributing

1. Create a feature branch from `main`

2. Make your changes with clear commit messages

3. Test thoroughly in development environment

4. Submit a pull request with detailed description

## Support

For issues and questions:

- Create an issue in the repository

- Contact the development team
