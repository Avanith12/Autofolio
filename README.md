# Autofolio

AI-powered portfolio website generator that creates professional, responsive portfolio websites using Google's Gemini AI. Generates complete HTML, CSS, JavaScript files and custom images ready for deployment.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Google Gemini API key

## Installation

1. Clone the repository and navigate to the project:
```bash
cd Autofolio/Website
```

2. Install server dependencies:
```bash
cd app/server
npm install
```

3. Install client dependencies:
```bash
cd ../client
npm install
```

4. Create `.env` file in `app/server` directory:
```env
PORT=8787
GEMINI_API_KEY=your_api_key_here
GEMINI_API_KEY_BACKUP1=optional_backup_key_1
GEMINI_API_KEY_BACKUP2=optional_backup_key_2
TEXT_MODEL=gemini-2.5-flash
IMAGE_MODEL=gemini-2.5-flash-image
```

## Running

Start the server:
```bash
cd app/server
npm start
```

Start the client (development):
```bash
cd app/client
npm run dev
```

Server runs on `http://localhost:8787`, client on `http://localhost:5173`.

## API Endpoints

### POST /api/generate-spec

Generates website specification from user input.

**Request Body**:
```json
{
  "name": "John Doe",
  "title": "Full Stack Developer",
  "tagline": "Building beautiful web experiences",
  "about": "Experienced developer...",
  "email": "john@example.com",
  "accent": "#6366F1",
  "skills": ["React", "Node.js", "TypeScript"],
  "projects": [
    {"title": "Project Name", "desc": "Description"}
  ]
}
```

Or use natural language prompt:
```json
{
  "prompt": "Create a portfolio for a software engineer..."
}
```

**Response**:
```json
{
  "ok": true,
  "id": "project-id"
}
```

### POST /api/generate-assets

Generates images for the portfolio.

**Request Body**:
```json
{
  "id": "project-id"
}
```

### POST /api/build

Builds final website and creates ZIP archive.

**Request Body**:
```json
{
  "id": "project-id"
}
```

**Response**:
```json
{
  "ok": true,
  "id": "project-id",
  "previewUrl": "http://localhost:8787/preview/{id}/build/index.html",
  "downloadUrl": "http://localhost:8787/download/{id}"
}
```

### GET /download/:id

Downloads the generated website as ZIP file.

### GET /api/health

Health check endpoint.

## Color Format Support

Supports hex (`#FF5733`), RGB (`rgb(255, 87, 51)`), RGBA, HSL, named colors (`coral`, `teal`), and multiple colors (`"#6366F1, #8B5CF6"`). Invalid colors fallback to default `#22D3EE`.

## Project Structure

```
Autofolio/
├── Website/
│   ├── app/
│   │   ├── client/          # React frontend
│   │   ├── server/          # Node.js backend
│   │   └── projects/        # Generated projects (runtime)
│   └── requirements.txt
└── README.md
```

## Team

**Team Name:** Brainy Brunch

**Team Members:**
- Sireesha
- Avanith
- Sumedha
- Pranathi
- Ila
- Rami
