import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import archiver from "archiver";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Get the directory where server.js is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8787;
// Fix: Use __dirname to go up from server/ to project root, then into app/projects
const PROJECTS = path.join(__dirname, "..", "projects");
fs.mkdirSync(PROJECTS, { recursive: true });
console.log(`📁 Projects directory: ${PROJECTS}`);

// Collect Gemini API keys (primary + optional backups)
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_BACKUP1,
  process.env.GEMINI_API_KEY_BACKUP2
].filter(key => key && key !== "your_api_key_here");

if (!GEMINI_KEYS.length) {
  console.warn("⚠ WARNING: No Gemini API keys configured. Text/image generation will fail.");
  console.warn("⚠ Set GEMINI_API_KEY (and optional backups) in app/server/.env file");
}

// ---------- helpers ----------
const newId = () => Math.random().toString(36).slice(2, 10);
const dirFor = id => path.join(PROJECTS, id);
const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-2.5-flash";
const IMAGE_MODEL_CANDIDATES = [
  process.env.IMAGE_MODEL || "gemini-2.5-flash-image",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation"
].filter(Boolean);

function maskedKey(key = "") {
  if (!key) return "unknown";
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function getErrorStatus(err) {
  return err?.status || err?.code || err?.response?.status || err?.cause?.status;
}

function isRetryableError(err) {
  const status = getErrorStatus(err);
  const message = (err?.message || "").toLowerCase();
  return status === 429 || status === 503 || message.includes("quota") || message.includes("overloaded") || message.includes("rate limit");
}

function buildGenAiTextClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

function buildLegacyTextClient(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}

function buildImageClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

function buildLegacyImageClient(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}


const TEMPLATE_PATH = path.join(__dirname, "templates", "base_template.html");
let TEMPLATE_HTML = "";
try {
  TEMPLATE_HTML = fs.readFileSync(TEMPLATE_PATH, "utf8");
} catch {
  // fallback template with image placeholders
  TEMPLATE_HTML = `
<!doctype html><html><head><meta charset=utf-8><title>{{NAME}}</title></head>
<body>
<header><h1>{{NAME}}</h1></header>
<main>
  <section class="hero"><img src="{{HERO_IMAGE}}" alt="hero"><h2>{{TITLE}}</h2><p>{{TAGLINE}}</p></section>
  <section id="projects">
    <article><img src="{{PROJECT_1_IMG}}" alt="p1"><h3>{{PROJECT_1_TITLE}}</h3><p>{{PROJECT_1_DESC}}</p></article>
    <article><img src="{{PROJECT_2_IMG}}" alt="p2"><h3>{{PROJECT_2_TITLE}}</h3><p>{{PROJECT_2_DESC}}</p></article>
    <article><img src="{{PROJECT_3_IMG}}" alt="p3"><h3>{{PROJECT_3_TITLE}}</h3><p>{{PROJECT_3_DESC}}</p></article>
  </section>
</main>
</body></html>
`.trim();
}

const SYSTEM_PROMPT = (templateHtml) => `
You are an EXPERT web developer. Your task is to generate a COMPLETE, PROFESSIONAL, BEAUTIFUL portfolio website.

CRITICAL - YOU MUST FOLLOW THESE RULES EXACTLY:

1. HTML STRUCTURE REQUIREMENTS:
   - MUST include: <header> with navigation, <main> with sections, <footer>
   - Hero section MUST have: full-width background with {{HERO_IMAGE}} (abstract pattern, NOT superhero), name, title, tagline, call-to-action button
   - About section MUST have: heading, 2-3 expanded professional paragraphs based on user's "about" text - ENHANCE it, don't just copy-paste!
   - Skills section MUST have: heading, visual display of ALL skills as styled chips/badges
   - Projects section MUST have: heading, grid of project cards - each card MUST have:
     * Project image: <img src="{{PROJECT_1_IMG}}"> etc.
     * Project title (from user's projects array - NOT empty!)
     * Project description (from user's projects array - NOT empty!)
     * Hover effects and proper styling
   - Contact section MUST have: heading, email link, social links
   - Footer MUST have: copyright with user's name, year

2. HTML CONTENT RULES:
   - EVERY heading MUST contain actual text (user's name, title, etc.) - NEVER empty!
   - EVERY paragraph MUST contain actual content from user's input - NEVER empty tags like <p></p>!
   - About section: You MUST expand the user's "about" text into 2-3 professional, well-written paragraphs. 
     * Don't just copy-paste the user's input - enhance it, expand it, make it professional
     * Add details about their expertise, approach, passion
     * Make it engaging and professional
   - EVERY project card MUST show the actual project title and description from user's input
   - Use semantic HTML5: <nav>, <section>, <article>, <header>, <footer>

3. CSS REQUIREMENTS (MUST BE 400+ LINES):
   - CSS Variables: :root { --primary-color, --secondary-color, --accent-color, --text-color, --bg-color, spacing variables }
   - Typography: Beautiful font stack, proper font sizes (clamp for responsive), line heights, weights
   - Layout: Use CSS Grid for main layout, Flexbox for components
   - Hero Section: Full viewport height, centered content, background image with overlay
   - Navigation: Sticky/fixed header, smooth scroll behavior
   - Project Cards: Grid layout (3 columns desktop, 2 tablet, 1 mobile), card hover effects, shadows, border-radius
   - Skills Section: Flexbox wrap, styled chips/badges with accent color
   - Responsive: Mobile-first breakpoints at 768px, 1024px, 1440px
   - Animations: Smooth transitions on hover (0.3s ease), subtle fade-ins
   - Spacing: Consistent padding/margin using CSS variables
   - Colors: Professional color scheme using user's accent color

4. JavaScript REQUIREMENTS:
   - Smooth scrolling for anchor links
   - Mobile menu toggle (hamburger menu)
   - Dynamic year in footer
   - Any interactive animations

5. MANDATORY SECTIONS ORDER:
   <header>Navigation</header>
   <main>
     <section class="hero">Hero with image, name, title, tagline, CTA</section>
     <section id="about">About Me with user's about text</section>
     <section id="skills">Skills with all user skills displayed</section>
     <section id="projects">Projects grid with user's project cards</section>
     <section id="contact">Contact information</section>
   </main>
   <footer>Footer with copyright</footer>

Schema (must match exactly):
{
  "site_name": "string (user's name)",
  "files": [
    {"path": "index.html", "content": "COMPLETE HTML with ALL sections fully populated with user data"},
    {"path": "styles.css", "content": "COMPREHENSIVE CSS with 400+ lines of professional styling"},
    {"path": "script.js", "content": "COMPLETE JavaScript with smooth scroll, mobile menu, animations"}
  ],
  "assetsNeeded": {
    "heroImage": "professional hero image description based on user's title and tagline",
    "projectImages": [
      "detailed description for project 1 image based on ACTUAL project 1 title and description from user",
      "detailed description for project 2 image based on ACTUAL project 2 title and description from user", 
      "detailed description for project 3 image based on ACTUAL project 3 title and description from user"
    ]
  }
}

CRITICAL FOR IMAGE GENERATION IN assetsNeeded:
- heroImage MUST describe an ABSTRACT GEOMETRIC BACKGROUND PATTERN - NOT superheroes, NOT people, NOT characters
- heroImage should be: "abstract geometric patterns, modern web design, professional background, subtle gradients, clean shapes"
- STRICTLY FORBIDDEN: superhero, character, person, costume, action hero, comic book style
- projectImages MUST describe images relevant to each ACTUAL project the user provided
- For example: if user has "E-Commerce Platform" project, the image description should mention e-commerce, shopping cart, payment systems, etc.
- DO NOT use generic descriptions like "laptop" or "website" - be specific based on the project

ABSOLUTE REQUIREMENTS:
- NEVER generate empty HTML tags: <h2></h2>, <p></p>, <h3></h3> - ALWAYS fill with user's actual data
- CSS MUST be 400+ lines with complete, professional styling
- Every section MUST be fully styled and functional
- Images MUST be properly sized and arranged using CSS Grid/Flexbox
- Output ONLY pure JSON - no markdown, no explanations, no code fences
- The portfolio MUST look like a $5000+ professional website, not a basic template
`;

function makeUserPromptFromStructured(body = {}) {
  // Handle prompt mode (when body.prompt is provided)
  if (body.prompt) {
    return `
YOU ARE CREATING A COMPLETE PROFESSIONAL PORTFOLIO WEBSITE.

USER'S REQUEST:
${body.prompt}

=== MANDATORY SECTIONS YOU MUST CREATE ===

1. HEADER & NAVIGATION:
   - Fixed/sticky navigation bar
   - Logo or name on the left
   - Navigation links: About, Skills, Projects, Contact

2. HERO SECTION:
   - Full viewport height (100vh)
   - Background image: {{HERO_IMAGE}}
   - Centered content with:
     * Large name/title
     * Subtitle/tagline
     * Call-to-action button
   - Overlay for text readability

3. ABOUT SECTION (#about):
   - Heading: "About Me" or similar
   - 2-3 paragraphs of content based on user's request
   - Professional styling with proper spacing

4. SKILLS SECTION (#skills):
   - Heading: "Skills" or "Technologies"
   - Display skills as styled chips/badges
   - Use Flexbox wrap for responsive layout
   - Use accent color from user request

5. PROJECTS SECTION (#projects):
   - Heading: "Projects" or "My Work"
   - CSS Grid layout (3 columns desktop, responsive)
   - Project cards with:
     * Image: {{PROJECT_1_IMG}}, {{PROJECT_2_IMG}}, {{PROJECT_3_IMG}}
     * Project title
     * Project description
     * Hover effects and shadows
   - Extract project details from user's description

6. CONTACT SECTION (#contact):
   - Heading: "Contact" or "Get In Touch"
   - Email form or email link
   - Social media links (placeholder)
   - Professional styling

7. FOOTER:
   - Copyright notice with current year
   - Additional links if needed
   - Professional styling

=== CSS REQUIREMENTS (MUST BE 400+ LINES) ===
- CSS Variables in :root for all colors, spacing, fonts
- Modern typography with responsive font sizes (clamp)
- CSS Grid for main layouts
- Flexbox for components
- Smooth transitions and animations (0.3s ease)
- Hover effects on all interactive elements
- Responsive breakpoints: mobile (default), tablet (768px), desktop (1024px)
- Professional color scheme
- Proper spacing and padding throughout

=== JAVASCRIPT REQUIREMENTS ===
- Smooth scrolling for anchor links
- Mobile menu toggle (hamburger menu)
- Set current year in footer
- Any animations or interactive elements mentioned in user request

=== ABSOLUTE RULES ===
- NEVER create empty HTML tags - ALWAYS fill with content!
- CSS MUST be 400+ lines of comprehensive styling
- Extract ALL information from user's description and use it in the website
- Images MUST be properly sized and arranged using CSS Grid/Flexbox
- Make it look like a $5000+ professional portfolio website
- Output ONLY valid JSON - no markdown, no explanations

Create a BEAUTIFUL, COMPLETE, PROFESSIONAL portfolio based on: "${body.prompt}"
`.trim();
  }

  // Handle structured form mode
  const {
    name = "Portfolio Owner",
    title = "Web Developer",
    tagline = "I build fast, accessible interfaces.",
    about = "Short paragraph about me.",
    email = "hello@example.com",
    accent = "#22D3EE",
    skills = ["HTML", "CSS", "JavaScript"],
    projects = [
      { title: "Project Alpha", desc: "First project." },
      { title: "Project Beta",  desc: "Second project." },
      { title: "Project Gamma", desc: "Third project." }
    ],
  } = body;

  // Ensure skills is an array
  const skillsList = Array.isArray(skills) ? skills : (typeof skills === 'string' ? skills.split(',').map(s => s.trim()).filter(Boolean) : ["HTML", "CSS", "JavaScript"]);
  
  // Ensure projects is an array and has proper structure
  const projectsList = Array.isArray(projects) && projects.length > 0 
    ? projects.slice(0, 6).map((p, i) => `- ${i+1}. ${p.title || `Project ${i+1}`} — ${p.desc || "No description"}`).join("\n")
    : "- No projects specified";

  return `
YOU ARE CREATING A COMPLETE PROFESSIONAL PORTFOLIO WEBSITE. USE ALL THE USER DATA BELOW.

=== USER DATA - YOU MUST USE ALL OF THIS ===
Name: "${name}"
Professional Title: "${title}"
Tagline: "${tagline}"
Email: "${email}"
About Me Text: "${about || "Passionate professional with expertise in web development"}"
Accent Color: "${accent}" - USE THIS for buttons, links, highlights, skill chips

SKILLS TO DISPLAY (create styled chips/badges for each):
${skillsList.map(s => `- ${s}`).join("\n")}

PROJECTS TO SHOWCASE (create cards with title AND description):
${projectsList.split("\n").map((p, i) => `Project ${i + 1}: ${p}`).join("\n")}

=== CRITICAL REQUIREMENTS ===

1. HTML - MUST INCLUDE ALL SECTIONS WITH USER DATA:
   - Header Navigation: Links to #about, #skills, #projects, #contact
   - Hero Section: 
     * Background image: {{HERO_IMAGE}}
     * Display: "${name}" (NOT empty!)
     * Subtitle: "${title}" (NOT empty!)
     * Tagline: "${tagline}" (NOT empty!)
     * CTA button: "View My Work" or "Contact Me"
   - About Section (#about):
     * Heading: "About Me"
     * You MUST expand "${about || "Passionate professional with expertise in web development"}" into 2-3 professional, engaging paragraphs
     * Don't just copy-paste - enhance and expand the user's about text
     * Add professional details, expertise areas, passion, and approach to work
     * Make it compelling and well-written (ACTUAL EXPANDED TEXT, NOT EMPTY!)
   - Skills Section (#skills):
     * Heading: "Skills" or "Technologies"
     * Display ALL skills: ${skillsList.map(s => `"${s}"`).join(", ")} as styled chips/badges
     * Use accent color: ${accent}
   - Projects Section (#projects):
     * Heading: "Projects" or "My Work"
     * Grid layout with project cards
     * Each project card MUST include:
       - Image: {{PROJECT_1_IMG}}, {{PROJECT_2_IMG}}, {{PROJECT_3_IMG}}
       - Title from user's project data (NOT empty!)
       - Description from user's project data (NOT empty!)
   - Contact Section (#contact):
     * Heading: "Contact" or "Get In Touch"
     * Email: <a href="mailto:${email}">${email}</a>
     * Social links placeholder
   - Footer:
     * Copyright: "© ${new Date().getFullYear()} ${name}. All rights reserved."

2. CSS - MUST BE 400+ LINES WITH:
   - CSS Variables in :root for ALL colors (primary, accent: ${accent}, text, bg, etc.)
   - Typography: system font stack, responsive font sizes using clamp()
   - Hero: min-height: 100vh, centered content, background image with overlay
   - Navigation: sticky/fixed position, smooth scroll
   - Project cards: CSS Grid (3 cols desktop, 2 tablet, 1 mobile), hover effects, shadows
   - Skills: Flexbox wrap, chips with accent color ${accent}, rounded corners
   - Responsive: @media queries for 768px, 1024px, 1440px
   - Animations: transitions (0.3s ease), hover effects, fade-ins
   - Proper spacing using CSS variables

3. JavaScript - MUST INCLUDE:
   - Smooth scrolling for navigation links
   - Mobile menu toggle (hamburger for mobile)
   - Set current year in footer dynamically
   - Any interactive animations

4. ABSOLUTE RULES:
   - NEVER create empty tags like <h2></h2>, <p></p> - ALWAYS fill with user's actual data!
   - EVERY heading and paragraph MUST contain the user's real information
   - CSS MUST be comprehensive (400+ lines) - not minimal styling!
   - Images MUST be properly arranged using CSS Grid/Flexbox
   - Make it look like a $5000+ professional portfolio website

OUTPUT MUST BE VALID JSON ONLY - NO MARKDOWN, NO EXPLANATIONS.
`.trim();
}

function robustJsonExtract(s) {
  if (!s) throw new Error("Empty model output");
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1) {
    const candidate = s.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error("Invalid JSON from model");
}

async function generateText(prompt) {
  if (!GEMINI_KEYS.length) {
    throw new Error("No Gemini API keys configured. Please set them in app/server/.env file");
  }

  let lastError;
  for (let i = 0; i < GEMINI_KEYS.length; i += 1) {
    const apiKey = GEMINI_KEYS[i];
    try {
      const text = await generateTextWithKey(apiKey, prompt);
      if (i > 0) {
        console.log(`✓ Generated text using backup key ${i + 1} (${maskedKey(apiKey)})`);
      } else {
        console.log("✓ Generated text using primary key");
      }
      return text;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      const msg = err?.message || err?.toString() || "Unknown error";
      if (retryable && i < GEMINI_KEYS.length - 1) {
        console.warn(`✗ Text generation failed with key ${i + 1} (${maskedKey(apiKey)}): ${msg} → trying next key`);
        continue;
      }
      throw new Error(`Text generation failed: ${msg}`);
    }
  }

  throw lastError || new Error("Text generation failed");
}

async function generateTextWithKey(apiKey, prompt) {
  const modelId = TEXT_MODEL;

  // Try the newer @google/genai API first
  try {
    const client = buildGenAiTextClient(apiKey);
    const response = await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    if (response?.text) {
      return response.text;
    }

    const alt = response?.candidates?.[0]?.content?.parts
      ?.filter(part => part.text)
      ?.map(part => part.text)
      ?.join("");

    if (alt) {
      return alt;
    }
  } catch (err) {
    if (!isRetryableError(err)) {
      throw err;
    }
    console.warn(`⚠ @google/genai text API (key ${maskedKey(apiKey)}) error: ${err.message}. Falling back to legacy client...`);
  }

  // Fallback to older @google/generative-ai API
  try {
    const legacy = buildLegacyTextClient(apiKey);
    const model = legacy.getGenerativeModel({ model: modelId });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }]}]
    });

    if (typeof result?.response?.text === "function") {
      const text = result.response.text();
      if (text) return text;
    } else if (typeof result?.response?.text === "string") {
      return result.response.text;
    }

    const alt = result?.response?.candidates?.[0]?.content?.parts
      ?.filter(part => part.text)
      ?.map(part => part.text)
      ?.join("");

    if (alt) {
      return alt;
    }

    throw new Error("Empty response from Gemini");
  } catch (err) {
    throw err;
  }
}

async function generatePlaceholderImage(width = 1200, height = 600) {
  // Download a placeholder image from a service
  try {
    const url = `https://via.placeholder.com/${width}x${height}.png`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (e) {
    // Fallback: create minimal 1x1 pixel PNG (base64 encoded)
    // This is a valid 1x1 pixel transparent PNG
    const minimalPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    return minimalPng;
  }
}

async function generateImageToFile({ prompt, outFile }) {
  if (!GEMINI_KEYS.length) {
    throw new Error("No Gemini API keys configured. Please set them in app/server/.env file");
  }

  let lastError;
  for (let i = 0; i < GEMINI_KEYS.length; i += 1) {
    const apiKey = GEMINI_KEYS[i];
    try {
      await generateImageWithKey(apiKey, prompt, outFile);
      if (i > 0) {
        console.log(`✓ Generated image using backup key ${i + 1} (${maskedKey(apiKey)})`);
      }
      return outFile;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      const msg = err?.message || err?.toString() || "Unknown error";
      if (retryable && i < GEMINI_KEYS.length - 1) {
        console.warn(`✗ Image generation failed with key ${i + 1} (${maskedKey(apiKey)}): ${msg} → trying next key`);
        continue;
      }
      throw new Error(`Image generation failed: ${msg}`);
    }
  }

  throw lastError || new Error("Image generation failed");
}

async function generateImageWithKey(apiKey, prompt, outFile) {
  const client = buildImageClient(apiKey);

  for (const modelName of IMAGE_MODEL_CANDIDATES) {
    try {
      const response = await client.models.generateContent({ model: modelName, contents: prompt });
      const inlinePart = response?.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
      if (inlinePart?.inlineData?.data) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, Buffer.from(inlinePart.inlineData.data, "base64"));
        console.log(`✓ Generated image with ${modelName} using @google/genai (key ${maskedKey(apiKey)})`);
        return outFile;
      }
    } catch (err) {
      if (!isRetryableError(err)) {
        throw err;
      }
      console.warn(`✗ Model ${modelName} failed with key ${maskedKey(apiKey)}: ${err.message}`);
      continue;
    }
  }

  // Fallback to older @google/generative-ai API
  const legacy = buildLegacyImageClient(apiKey);
  const legacyModels = ["gemini-2.5-flash-image", "gemini-2.0-flash-exp-image-generation"];

  for (const modelName of legacyModels) {
    try {
      const model = legacy.getGenerativeModel({ model: modelName });
      const resp = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }]}]
      });
      const part = resp.response?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
      if (part?.inlineData?.data) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, Buffer.from(part.inlineData.data, "base64"));
        console.log(`✓ Generated image with ${modelName} using @google/generative-ai (key ${maskedKey(apiKey)})`);
        return outFile;
      }
    } catch (err) {
      if (!isRetryableError(err)) {
        throw err;
      }
      console.warn(`✗ Fallback model ${modelName} failed with key ${maskedKey(apiKey)}: ${err.message}`);
      continue;
    }
  }

  throw new Error("No image data returned from Gemini");
}

function replaceInFiles(files, replacements) {
  return files.map(f => {
    if (!f?.path || typeof f.content !== "string") return f;
    let content = f.content;
    for (const [k, v] of Object.entries(replacements)) {
      const token = new RegExp(`\\{\\{${k}\\}\\}`, "g");
      content = content.replace(token, v);
    }
    return { ...f, content };
  });
}

// Helper function to expand about text into professional paragraphs
function expandAboutText(aboutText, title, skillsList) {
  // If user provided good about text, use it as the base
  let firstParagraph = aboutText;
  
  if (!aboutText || aboutText.trim().length < 20) {
    // Generate base text from title and skills
    const skillsMention = skillsList && skillsList.length > 0 
      ? skillsList.slice(0, 3).join(", ")
      : "web development";
    firstParagraph = `I'm a passionate ${title || "professional"} specializing in ${skillsMention}. I love creating innovative solutions that combine cutting-edge technology with intuitive user experiences.`;
  } else {
    // Enhance user's text
    firstParagraph = aboutText;
    // If it's too short, add more context
    if (aboutText.trim().length < 100) {
      const skillsMention = skillsList && skillsList.length > 0 
        ? ` With strong skills in ${skillsList.slice(0, 4).join(", ")},`
        : "";
      firstParagraph = `${aboutText}${skillsMention} I'm dedicated to delivering high-quality work.`;
    }
  }
  
  // Create enhanced about section with multiple professional paragraphs
  const skillsContext = skillsList && skillsList.length > 0 
    ? ` With expertise spanning ${skillsList.slice(0, 5).join(", ")},`
    : "";
  
  return `      <p>${firstParagraph}</p>
      <p>${skillsContext} I bring a combination of technical expertise and creative problem-solving to every project. My approach focuses on creating solutions that are not only functional and scalable but also user-friendly and visually appealing.</p>
      <p>When I'm not working on projects, you can find me exploring new technologies, contributing to open-source communities, or sharing knowledge with fellow developers. I'm always excited to take on new challenges and collaborate on innovative projects that make a real impact.</p>`;
}

// ---------- routes ----------
// Helper function to fix and enhance manifest
function validateAndEnhanceManifest(manifest, userData) {
  // Ensure all files exist
  if (!manifest.files || !Array.isArray(manifest.files)) {
    throw new Error("Manifest must have a 'files' array");
  }

  // Extract user data with defaults
  const name = userData?.name || "Portfolio Owner";
  const title = userData?.title || "Web Developer";
  const tagline = userData?.tagline || "Creating beautiful web experiences";
  const about = userData?.about || "Passionate professional with expertise in web development";
  const email = userData?.email || "contact@example.com";
  
const accentInput = userData?.accent || "#22D3EE";
const accentPalette = Array.isArray(accentInput)
  ? accentInput.filter(Boolean)
  : String(accentInput).split(',').map(s => s.trim()).filter(Boolean);
const accent = accentPalette[0] || "#22D3EE";
const accentSecondary = accentPalette[1] || accent;
const accentTertiary = accentPalette[2] || accentSecondary;
const paletteForAI = [accent, accentSecondary, accentTertiary].filter(Boolean);
const skills = Array.isArray(userData?.skills) ? userData.skills : 
              (typeof userData?.skills === 'string' ? userData.skills.split(',').map(s => s.trim()) : ["HTML", "CSS", "JavaScript"]);
  const projects = Array.isArray(userData?.projects) && userData.projects.length > 0 ? userData.projects : [
    { title: "Project 1", desc: "First project description" },
    { title: "Project 2", desc: "Second project description" },
    { title: "Project 3", desc: "Third project description" }
  ];

  // Find and FIX HTML file
  const htmlFile = manifest.files.find(f => f.path === "index.html");
  if (htmlFile && htmlFile.content) {
    let htmlContent = htmlFile.content;
    let fixed = false;

    // FIRST: Replace ALL placeholders with actual user data
    htmlContent = htmlContent.replace(/\{\{NAME\}\}/g, name);
    htmlContent = htmlContent.replace(/\{\{TITLE\}\}/g, title);
    htmlContent = htmlContent.replace(/\{\{TAGLINE\}\}/g, tagline);
    htmlContent = htmlContent.replace(/\{\{ABOUT\}\}/g, about);
    htmlContent = htmlContent.replace(/\{\{EMAIL\}\}/g, email);
    htmlContent = htmlContent.replace(/\{\{YEAR\}\}/g, new Date().getFullYear().toString());
    
    // Replace project-specific placeholders
    projects.forEach((proj, idx) => {
      if (proj && proj.title) {
        htmlContent = htmlContent.replace(new RegExp(`\\{\\{PROJECT_${idx + 1}_TITLE\\}\\}`, 'g'), proj.title);
      }
      if (proj && proj.desc) {
        htmlContent = htmlContent.replace(new RegExp(`\\{\\{PROJECT_${idx + 1}_DESC\\}\\}`, 'g'), proj.desc);
      }
    });

    // Fix empty tags by injecting user data
    // Fix empty h2 tags - in hero use title, otherwise use section-appropriate text
    htmlContent = htmlContent.replace(/<h2>\s*<\/h2>/g, (match, offset) => {
      const beforeContent = htmlContent.substring(0, offset);
      if (beforeContent.includes('class="hero"') || beforeContent.includes('class=\'hero\'')) {
        return `<h2>${title}</h2>`;
      }
      if (beforeContent.includes('id="about"') || beforeContent.includes("id='about'")) {
        return `<h2>About Me</h2>`;
      }
      return `<h2>${title}</h2>`;
    });

    // Fix empty h3 tags - usually project titles
    htmlContent = htmlContent.replace(/<h3>\s*<\/h3>/g, (match, offset) => {
      const beforeContent = htmlContent.substring(0, offset);
      // Find project number if near project images
      const projectMatch = beforeContent.match(/\{\{PROJECT_(\d)_IMG\}\}/);
      if (projectMatch) {
        const projectNum = parseInt(projectMatch[1]);
        const project = projects[projectNum - 1];
        if (project && project.title) {
          return `<h3>${project.title}</h3>`;
        }
        return `<h3>Project ${projectNum}</h3>`;
      }
      return `<h3>${title}</h3>`;
    });
    
    // Fix empty p tags
    htmlContent = htmlContent.replace(/<p>\s*<\/p>/g, (match, offset) => {
      const beforeContent = htmlContent.substring(0, offset);
      // If it's near a project image or project title, use project description
      const projectMatch = beforeContent.match(/\{\{PROJECT_(\d)_(IMG|TITLE|DESC)\}\}/);
      if (projectMatch) {
        const projectNum = parseInt(projectMatch[1]);
        const project = projects[projectNum - 1];
        if (project && project.desc) {
          return `<p>${project.desc}</p>`;
        }
        return `<p>Project ${projectNum} description</p>`;
      }
      // If it's in hero section, use tagline
      if (beforeContent.includes('class="hero"') || beforeContent.includes('class=\'hero\'')) {
        return `<p>${tagline}</p>`;
      }
      // If it's in about section, use about text
      if (beforeContent.includes('id="about"') || beforeContent.includes("id='about'")) {
        return `<p>${about}</p>`;
      }
      // Default to about text
      return `<p>${about}</p>`;
    });

    // Ensure navigation header exists with proper structure
    if (!htmlContent.includes('<header') || !htmlContent.includes('<nav')) {
      const bodyMatch = htmlContent.match(/(<body[^>]*>)/);
      if (bodyMatch) {
        const navHtml = `  <header>
    <h1>${name}</h1>
    <nav>
      <a href="#about">About</a>
      <a href="#skills">Skills</a>
      <a href="#projects">Projects</a>
      <a href="#contact">Contact</a>
    </nav>
  </header>`;
        htmlContent = htmlContent.replace(bodyMatch[0], bodyMatch[0] + "\n" + navHtml);
        fixed = true;
      }
    }

    // Ensure all required sections exist
    if (!htmlContent.includes('id="about"') && !htmlContent.includes("id='about'")) {
      const mainMatch = htmlContent.match(/(<main[^>]*>)/);
      if (mainMatch) {
        // Expand about text into professional paragraphs
        const expandedAbout = expandAboutText(about, title, skills);
        htmlContent = htmlContent.replace(
          mainMatch[0],
          `${mainMatch[0]}\n    <section id="about" class="about">\n      <h2>About Me</h2>\n${expandedAbout}\n    </section>`
        );
        fixed = true;
      }
    } else {
      // Enhance existing about section if it's too short
      const aboutMatch = htmlContent.match(/(<section[^>]*id=["']about["'][^>]*>)([\s\S]*?)(<\/section>)/);
      if (aboutMatch) {
        const aboutContent = aboutMatch[2];
        // Check if about section has minimal content
        if (!aboutContent.includes('</p>') || aboutContent.match(/<p>/g)?.length < 2) {
          const expandedAbout = expandAboutText(about, title, skills);
          htmlContent = htmlContent.replace(aboutMatch[0], aboutMatch[1] + expandedAbout + aboutMatch[3]);
          fixed = true;
          console.log("✓ Enhanced about section with expanded professional content");
        }
      }
    }

    // Ensure skills section exists and shows ALL user skills
    if (!htmlContent.includes('id="skills"') && !htmlContent.includes("id='skills'")) {
      const projectsMatch = htmlContent.match(/(<section[^>]*id=["']projects["'][^>]*>)/);
      if (projectsMatch) {
        const skillsHtml = `
    <section id="skills" class="skills">
      <h2>Skills & Technologies</h2>
      <ul class="skills-list">
${skills.map(s => `        <li>${s}</li>`).join("\n")}
      </ul>
    </section>`;
        htmlContent = htmlContent.replace(projectsMatch[0], skillsHtml + "\n    " + projectsMatch[0]);
        fixed = true;
      }
    } else {
      // Skills section exists but might be empty - ensure skills are displayed
      const skillsMatch = htmlContent.match(/(<section[^>]*id=["']skills["'][^>]*>[\s\S]*?)(<\/section>)/);
      if (skillsMatch && skills.length > 0) {
        // Check if skills list is empty or has placeholders
        if (!skillsMatch[1].includes('<li>') || skillsMatch[1].match(/<li>/g)?.length < skills.length) {
          // Replace empty or incomplete skills list
          const skillsListHtml = `<ul class="skills-list">
${skills.map(s => `        <li>${s}</li>`).join("\n")}
      </ul>`;
          htmlContent = htmlContent.replace(
            skillsMatch[0],
            skillsMatch[1].replace(/<ul[^>]*>[\s\S]*?<\/ul>/i, skillsListHtml) + skillsMatch[2]
          );
          fixed = true;
          console.log(`✓ Fixed skills section with ${skills.length} skills`);
        }
      }
    }

    if (!htmlContent.includes('id="contact"') && !htmlContent.includes("id='contact'")) {
      const mainEndMatch = htmlContent.match(/(<\/main>)/);
      if (mainEndMatch) {
        htmlContent = htmlContent.replace(
          mainEndMatch[0],
          `    <section id="contact" class="contact">\n      <h2>Get In Touch</h2>\n      <p>Email: <a href="mailto:${email}">${email}</a></p>\n    </section>\n  ${mainEndMatch[0]}`
        );
        fixed = true;
      }
    }

    if (!htmlContent.includes('<footer')) {
      const bodyEndMatch = htmlContent.match(/(<\/body>)/);
      if (bodyEndMatch) {
        htmlContent = htmlContent.replace(
          bodyEndMatch[0],
          `  <footer>\n    <p>© ${new Date().getFullYear()} ${name}. All rights reserved.</p>\n  </footer>\n${bodyEndMatch[0]}`
        );
        fixed = true;
      }
    }

    if (fixed) {
      console.log("✓ Fixed missing sections in HTML");
      htmlFile.content = htmlContent;
    }
  }

  // FIX CSS file - expand minimal CSS
  const cssFile = manifest.files.find(f => f.path === "styles.css");
  if (cssFile && cssFile.content) {
    const cssLines = cssFile.content.split('\n').length;
    if (cssLines < 100) {
      console.log(`⚠ CSS is only ${cssLines} lines - expanding with comprehensive styles...`);
      
      const basicCss = cssFile.content;
      const enhancedCss = `/* Comprehensive Portfolio Styles */
:root {
  --accent-color: ${accent};
  --accent-secondary: ${accentSecondary};
  --accent-tertiary: ${accentTertiary};
  --accent-gradient: linear-gradient(135deg, var(--accent-secondary), var(--accent-tertiary));
  --primary-color: ${accent};
  --text-color: #1e293b;
  --bg-color: #ffffff;
  --bg-light: #f8fafc;
  --text-muted: #64748b;
  --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --radius: 8px;
  --spacing-xs: 0.5rem;
  --spacing-sm: 1rem;
  --spacing-md: 2rem;
  --spacing-lg: 4rem;
  --spacing-xl: 6rem;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  color: var(--text-color);
  background-color: var(--bg-color);
  margin: 0;
  padding: 0;
}

/* Header & Navigation */
header {
  position: sticky;
  top: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
  z-index: 1000;
  padding: var(--spacing-sm) var(--spacing-md);
}

header h1 {
  margin: 0;
  font-size: clamp(1.25rem, 2vw, 1.5rem);
  color: var(--accent-color);
  font-weight: 700;
}

nav {
  display: flex;
  gap: var(--spacing-md);
}

nav a {
  color: var(--text-color);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s ease;
  position: relative;
}

nav a:hover {
  color: var(--accent-color);
}

nav a::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  width: 0;
  height: 2px;
  background: var(--accent-color);
  transition: width 0.3s ease;
}

nav a:hover::after {
  width: 100%;
}

/* Hero Section */
.hero {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacing-xl) var(--spacing-md);
  background: var(--accent-gradient);
  position: relative;
  overflow: hidden;
}

.hero img {
  width: 100%;
  max-width: 600px;
  max-height: 300px;
  height: auto;
  object-fit: cover;
  border-radius: var(--radius);
  margin: 0 auto var(--spacing-md);
  box-shadow: var(--shadow-lg);
  display: block;
}

.hero h2 {
  font-size: clamp(2rem, 5vw, 3.5rem);
  margin: var(--spacing-sm) 0;
  color: var(--text-color);
  font-weight: 700;
}

.hero p {
  font-size: clamp(1.125rem, 2vw, 1.25rem);
  color: var(--text-muted);
  max-width: 600px;
  margin: var(--spacing-sm) auto var(--spacing-md);
}

.cta {
  display: inline-block;
  background: var(--accent-color);
  color: white;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius);
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  margin-top: var(--spacing-md);
}

.cta:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* Sections */
section {
  padding: var(--spacing-xl) var(--spacing-md);
  max-width: 1200px;
  margin: 0 auto;
}

section h2 {
  font-size: clamp(2rem, 4vw, 2.5rem);
  margin-bottom: var(--spacing-md);
  text-align: center;
  color: var(--text-color);
}

/* About Section */
.about {
  background: var(--bg-light);
}

.about p {
  font-size: clamp(1rem, 2vw, 1.125rem);
  line-height: 1.8;
  color: var(--text-muted);
  max-width: 800px;
  margin: 0 auto;
}

/* Skills Section */
.skills {
  padding: var(--spacing-xl) var(--spacing-md);
}

.skills-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  justify-content: center;
  padding: 0;
}

.skills-list li {
  background: var(--accent-color);
  color: white;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: 20px;
  font-weight: 500;
  font-size: 0.9rem;
  border: 1px solid var(--accent-tertiary);
  box-shadow: 0 6px 18px -6px var(--accent-secondary);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.skills-list li:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px -8px var(--accent-tertiary);
}

/* Projects Section */
#projects {
  background: var(--bg-light);
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
}

.card {
  background: white;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.card:hover {
  transform: translateY(-8px);
  box-shadow: var(--shadow-lg);
}

.card img {
  width: 100%;
  height: 200px;
  max-height: 200px;
  object-fit: cover;
  display: block;
}

.card-body {
  padding: var(--spacing-md);
}

.card h3 {
  font-size: 1.25rem;
  margin-bottom: var(--spacing-xs);
  color: var(--text-color);
}

.card p {
  color: var(--text-muted);
  line-height: 1.6;
}

/* Contact Section */
.contact {
  text-align: center;
}

.contact a {
  color: var(--accent-color);
  text-decoration: none;
  font-weight: 500;
}

.contact a:hover {
  text-decoration: underline;
}

/* Footer */
footer {
  background: var(--text-color);
  color: white;
  text-align: center;
  padding: var(--spacing-md);
  margin-top: var(--spacing-xl);
}

footer p {
  margin: 0;
  font-size: 0.9rem;
}

/* Responsive Design */
@media (max-width: 768px) {
  header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-sm);
  }

  nav {
    flex-wrap: wrap;
  }

  .hero {
    min-height: 50vh;
    padding: var(--spacing-lg) var(--spacing-sm);
  }

  .hero img {
    max-height: 300px;
  }

  .projects-grid {
    grid-template-columns: 1fr;
  }

  section {
    padding: var(--spacing-lg) var(--spacing-sm);
  }
}

@media (max-width: 480px) {
  .hero h2 {
    font-size: 1.75rem;
  }

  .skills-list li {
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
  }
}
`;

      cssFile.content = enhancedCss;
      console.log(`✓ Expanded CSS from ${cssLines} to ${enhancedCss.split('\n').length} lines`);
    }
  }

  // Validate JavaScript file
  const jsFile = manifest.files.find(f => f.path === "script.js");
  if (jsFile && (!jsFile.content || jsFile.content.trim().length < 50)) {
    const enhancedJs = `// Portfolio JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Update year in footer
  const yearElement = document.querySelector('footer p');
  if (yearElement) {
    yearElement.innerHTML = yearElement.innerHTML.replace(/\\d{4}/, new Date().getFullYear());
  }

  // Mobile menu toggle (if needed)
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('nav');
  
  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }
});
`;
    jsFile.content = enhancedJs;
    console.log("✓ Enhanced JavaScript file");
  }

  manifest.accentPalette = paletteForAI;

  return manifest;
}

app.post("/api/generate-spec", async (req, res) => {
  try {
    const id = newId();
    const dir = dirFor(id);
    fs.mkdirSync(dir, { recursive: true });

    const userData = req.body || {};
    const basePrompt = SYSTEM_PROMPT(TEMPLATE_HTML) + "\n\n" + makeUserPromptFromStructured(userData);
    let prompt = basePrompt;

    console.log("📝 Generating website specification...");

    let manifest;
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
      const text = await generateText(prompt);
      try {
        manifest = robustJsonExtract(text);
        break;
      } catch (parseErr) {
        console.warn(`✗ Unable to parse manifest attempt ${attempt}: ${parseErr.message}`);
        if (attempt === MAX_RETRY) {
          throw parseErr;
        }
        prompt = `${basePrompt}

REMEMBER: Return ONLY valid JSON that matches the schema. No commentary, no markdown, no extra text.`;
      }
    }

    // Store userData in manifest FIRST, before validation
    manifest.userData = userData;

    // Validate and enhance manifest
    manifest = validateAndEnhanceManifest(manifest, userData);

    // Generate image prompts based on ACTUAL user data, not generic templates
    if (!manifest.assetsNeeded) {
      manifest.assetsNeeded = {};
    }

    // ALWAYS OVERRIDE hero image prompt - NO SUPERHERO THEMES EVER
    // Completely replace whatever AI suggested to prevent superhero images
    const title = userData?.title || "professional";
    const tagline = userData?.tagline || "portfolio";
    const paletteDescriptionForHero = paletteForAI.length ? `with color palette ${paletteForAI.join(", ")}, ` : "";
    const paletteDescriptionForProjects = paletteForAI.length ? `, color palette ${paletteForAI.join(", ")}` : "";
    manifest.assetsNeeded.heroImage = `abstract geometric background pattern, modern professional web design, minimalist style, ${paletteDescriptionForHero}subtle gradients and clean geometric shapes like triangles, circles, polygons, and hexagons, pattern texture, web design aesthetic, portfolio background, professional illustration, NO people, NO characters, NO superhero themes, NO costumes, NO persons, NO human figures, NO masked characters, NO caped figures, abstract only, geometric pattern only`;

    // Generate project image prompts based on ACTUAL project data
    if (!manifest.assetsNeeded.projectImages || manifest.assetsNeeded.projectImages.length === 0) {
      const projects = Array.isArray(userData?.projects) && userData.projects.length > 0 
        ? userData.projects.slice(0, 3)
        : [];
      
      manifest.assetsNeeded.projectImages = projects.map((proj, idx) => {
        if (proj && proj.title && proj.desc) {
          return `professional screenshot or mockup of ${proj.title} project: ${proj.desc}, modern UI design, clean interface${paletteDescriptionForProjects}, product mock photo, neutral background, no people, realistic web application`;
        }
        return `professional web application mockup, modern UI design, clean interface${paletteDescriptionForProjects}, product mock photo, neutral background, no people`;
      });

      // Fill remaining slots if less than 3 projects
      while (manifest.assetsNeeded.projectImages.length < 3) {
        manifest.assetsNeeded.projectImages.push("professional web application mockup, modern UI design, clean interface, product mock photo, neutral background, no people");
      }
    } else {
      // Enhance existing prompts with user's actual project data
      const projects = Array.isArray(userData?.projects) && userData.projects.length > 0 
        ? userData.projects.slice(0, 3)
        : [];
      
      manifest.assetsNeeded.projectImages = manifest.assetsNeeded.projectImages.map((prompt, idx) => {
        if (projects[idx] && projects[idx].title && projects[idx].desc) {
          // Replace generic prompts with actual project-based prompts
          return `professional screenshot or mockup of ${projects[idx].title} project: ${projects[idx].desc}, modern UI design, clean interface, product mock photo, neutral background, no people, realistic web application`;
        }
        return prompt;
      });
    }

    // userData already stored above, before validateAndEnhanceManifest

    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log("✓ Manifest generated successfully");
    res.json({ ok: true, id });
  } catch (e) {
    console.error("✗ Error generating spec:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/generate-assets", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: "missing id" });

    const dir = dirFor(id);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) return res.status(404).json({ ok: false, error: "manifest.json not found" });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    // Get userData from manifest or use for better image prompts
    const userData = manifest.userData || {};

    const assetsDir = path.join(dir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    const accentPalette = manifest.accentPalette || [];
    const paletteDescription = accentPalette.length ? `color palette ${accentPalette.join(", ")}, ` : "";
    const projectPaletteHint = accentPalette.length ? `, color palette ${accentPalette.join(", ")}` : "";

    const replacements = {};

    // ALWAYS generate hero image with STRICT abstract pattern prompt - NO SUPERHERO IMAGES EVER
    // Completely ignore whatever AI suggested and use our safe prompt
    const title = userData?.title || "professional";
    const tagline = userData?.tagline || "portfolio";
    
    // STRICT abstract pattern prompt - explicitly forbid ANY character/superhero themes
    const heroPrompt = `abstract geometric background pattern, modern professional web design, minimalist style, ${paletteDescription}subtle gradients and clean geometric shapes like triangles, circles, polygons, and hexagons, repeating pattern texture, portfolio website background, professional illustration, NO people, NO characters, NO superhero themes, NO costumes, NO persons, NO human figures, NO masked characters, NO caped figures, NO action heroes, NO comic book style, abstract geometric pattern ONLY, design elements only`;

    console.log(`🎨 Generating hero image (abstract pattern only): ${heroPrompt.substring(0, 100)}...`);
    const file = path.join(assetsDir, "hero.png");
    try {
      await generateImageToFile({ prompt: heroPrompt, outFile: file });
      replacements["HERO_IMAGE"] = "./assets/hero.png";
      console.log(`✓ Hero image generated successfully`);
    } catch (imageError) {
      console.error(`✗ Hero image generation failed: ${imageError.message}`);
      // Use placeholder instead
      const placeholder = await generatePlaceholderImage(1200, 600);
      fs.writeFileSync(file, placeholder);
      replacements["HERO_IMAGE"] = "./assets/hero.png";
      console.log(`⚠ Using placeholder image for hero`);
    }

    // Generate project images based on ACTUAL project data
    const imgs = Array.isArray(manifest.assetsNeeded?.projectImages)
      ? manifest.assetsNeeded.projectImages.slice(0, 3)
      : [];

    const projects = Array.isArray(userData?.projects) ? userData.projects.slice(0, 3) : [];

    // Generate images for ALL projects (up to 3)
    // If we have projects, use that count; otherwise use image prompt count; default to 3
    const numProjectsToGenerate = projects.length > 0 ? Math.min(projects.length, 3) : Math.min(imgs.length || 3, 3);
    
    for (let i = 0; i < numProjectsToGenerate; i++) {
      let imagePrompt = imgs[i];
      
      // Enhance prompt with actual project data if available
      if (projects[i] && projects[i].title && projects[i].desc) {
        imagePrompt = `professional screenshot or mockup of ${projects[i].title} web application project: ${projects[i].desc}, modern UI design, clean interface${projectPaletteHint}, realistic software application screenshot, product mock photo, neutral background, no people, professional web design`;
        console.log(`🎨 Generating project ${i + 1} image for: ${projects[i].title}`);
      } else if (imgs[i]) {
        // Use the prompt from manifest but ensure it's not generic
        imagePrompt = imgs[i];
        console.log(`🎨 Generating project ${i + 1} image with prompt from manifest`);
      } else {
        // Generate a reasonable default based on project index
        imagePrompt = `professional software application screenshot mockup, modern UI design, clean interface${projectPaletteHint}, portfolio project image, neutral background, no people`;
        console.log(`🎨 Generating project ${i + 1} image with default prompt`);
      }

      const out = path.join(assetsDir, `project_${i + 1}.png`);
      try {
        await generateImageToFile({ prompt: imagePrompt, outFile: out });
        replacements[`PROJECT_${i + 1}_IMG`] = `./assets/project_${i + 1}.png`;
        console.log(`✓ Project ${i + 1} image generated`);
      } catch (imageError) {
        console.error(`✗ Project ${i + 1} image generation failed: ${imageError.message}`);
        // Use placeholder instead
        const placeholder = await generatePlaceholderImage(800, 600);
        fs.writeFileSync(out, placeholder);
        replacements[`PROJECT_${i + 1}_IMG`] = `./assets/project_${i + 1}.png`;
        console.log(`⚠ Using placeholder image for project ${i + 1}`);
      }
    }

    if (Object.keys(replacements).length) {
      manifest.files = replaceInFiles(manifest.files, replacements);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/build", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: "missing id" });

    const dir = dirFor(id);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ ok: false, error: "manifest.json not found" });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    const buildDir = path.join(dir, "build");
    fs.mkdirSync(buildDir, { recursive: true });

    // write files
    for (const f of manifest.files) {
      if (!f?.path || typeof f.content !== "string") continue;
      if (f.path.includes("..")) continue;
      const dest = path.join(buildDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content, "utf8");
    }

    // copy assets into build/assets
    const srcAssets = path.join(dir, "assets");
    const dstAssets = path.join(buildDir, "assets");
    if (fs.existsSync(srcAssets)) {
      fs.mkdirSync(dstAssets, { recursive: true });
      for (const f of fs.readdirSync(srcAssets)) {
        fs.copyFileSync(path.join(srcAssets, f), path.join(dstAssets, f));
      }
    }

    // zip for download (optional)
    const zipPath = path.join(dir, "site.zip");
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(buildDir, false);
      archive.finalize();
    });

    res.json({
      ok: true,
      id,
      previewUrl: `http://localhost:${PORT}/preview/${id}/build/index.html`,
      downloadUrl: `http://localhost:${PORT}/download/${id}`
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// static + download
app.use("/preview", express.static(PROJECTS));
app.get("/download/:id", (req, res) => {
  const zip = path.join(PROJECTS, req.params.id, "site.zip");
  if (!fs.existsSync(zip)) return res.status(404).send("Not found");
  res.download(zip, "site.zip");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    textModel: process.env.TEXT_MODEL || "gemini-2.5-flash",
    imageModel: process.env.IMAGE_MODEL || "gemini-2.5-flash-image",
    pid: process.pid
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Projects directory: ${PROJECTS}`);
  console.log(`📄 Template path: ${TEMPLATE_PATH}`);
  console.log(`\n✅ Ready to generate amazing portfolios!\n`);
});