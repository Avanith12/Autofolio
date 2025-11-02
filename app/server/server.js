import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import archiver from "archiver";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8787;
const PROJECTS = path.join(process.cwd(), "app", "projects");
fs.mkdirSync(PROJECTS, { recursive: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const newId = () => Math.random().toString(36).slice(2, 10);
const dirFor = id => path.join(PROJECTS, id);

const TEMPLATE_PATH = path.join(process.cwd(), "app", "server", "templates", "base_template.html");
let TEMPLATE_HTML = "";
try {
  TEMPLATE_HTML = fs.readFileSync(TEMPLATE_PATH, "utf8");
} catch {
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
You are a senior web developer.
Return ONLY a compact JSON manifest describing a static, mobile-first portfolio website.

HTML reference:
-----
${templateHtml}
-----

Schema (must match exactly):
{
  "site_name": "string",
  "files": [
    {"path": "index.html", "content": "..."},
    {"path": "styles.css", "content": "..."},
    {"path": "script.js", "content": "..."}
  ],
  "assetsNeeded": {
    "heroImage": "string",
    "projectImages": ["string","string","string"]
  }
}

Rules:
- Fully static HTML/CSS/JS.
- Include <img> placeholders {{HERO_IMAGE}}, {{PROJECT_1_IMG}}, {{PROJECT_2_IMG}}, {{PROJECT_3_IMG}} in index.html.
- No markdown, no code fences. Output must be valid JSON only.
`;

function makeUserPromptFromStructured(body = {}) {
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

  const lines = projects.slice(0, 6).map((p, i) => `- ${i+1}. ${p.title} — ${p.desc}`).join("\n");

  return `
Build a static portfolio using the reference HTML.
User brief:
- Name: ${name}
- Title: ${title}
- Tagline: ${tagline}
- Email: ${email}
- About: ${about}
- Accent: ${accent}
Skills: ${skills.join(", ")}
Projects:
${lines}

Images:
- Hero: light geometric triangles, neutral gray, web hero background, no people, no text.
- Project images: clean product/UI mockups on neutral background, no people, no neon.
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
  const model = genAI.getGenerativeModel({ model: process.env.TEXT_MODEL || "gemini-1.5-flash" });
  const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }]}] });
  return result.response.text();
}

async function generateImageToFile({ prompt, outFile, width = 1600, height = 900 }) {
  const modelName = process.env.IMAGE_MODEL || "gemini-2.5-flash-image";
  const model = genAI.getGenerativeModel({ model: modelName });

  const safePrompt =
    (prompt || "clean neutral geometric portfolio banner, no people, no text") +
    " | neutral colors | no people | no logos | studio lighting | web background | minimal | photograph-like";

  const resp = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: safePrompt }]}],
    generationConfig: {
      responseMimeType: "image/png",
    }
  });

  const cand = resp?.response?.candidates?.[0];
  const parts = cand?.content?.parts || [];

  if (cand?.finishReason === "SAFETY") {
    console.warn("[gemini] image blocked by safety. Writing placeholder.");
    return writePlaceholder(outFile, width, height, "#d1d5db", "#f3f4f6");
  }

  const inline = parts.find(p => p.inlineData && p.inlineData.data)?.inlineData?.data;

  if (!inline) {
    const txt = parts.find(p => typeof p.text === "string")?.text;
    if (txt) {
      console.warn("[gemini] returned text instead of image:", txt.slice(0, 140));
    } else {
      console.warn("[gemini] no inlineData present in response");
    }
    return writePlaceholder(outFile, width, height, "#d1d5db", "#f3f4f6");
  }

  const buf = Buffer.from(inline, "base64");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return outFile;
}

function writePlaceholder(outFile, width, height, c1 = "#d1d5db", c2 = "#f3f4f6") {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <g opacity="0.25">
    <path d="M0 ${height*0.7} L ${width*0.3} ${height*0.4} L ${width*0.6} ${height*0.8} L ${width} ${height*0.5} L ${width} ${height} L 0 ${height} Z" fill="#e5e7eb"/>
  </g>
</svg>`.trim();

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(svg, "utf8"));
  return outFile;
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

// ---------- routes ----------
app.post("/api/generate-spec", async (req, res) => {
  try {
    const id = newId();
    const dir = dirFor(id);
    fs.mkdirSync(dir, { recursive: true });

    const prompt = SYSTEM_PROMPT(TEMPLATE_HTML) + "\n\n" + makeUserPromptFromStructured(req.body || {});
    const text = await generateText(prompt);

    let manifest = robustJsonExtract(text);

    // safety: ensure assetsNeeded exists
    if (!manifest.assetsNeeded) {
      manifest.assetsNeeded = {
        heroImage: "light geometric triangle pattern background, subtle gray gradient, clean, no people, no text",
        projectImages: [
          "laptop on white desk showing simple blue landing page UI, product mock photo, no people",
          "browser mockup on neutral background with case study layout, product mock photo, no people",
          "mobile phone on desk with card UI, neutral background, product mock photo, no people"
        ]
      };
    }

    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    res.json({ ok: true, id });
  } catch (e) {
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

    const assetsDir = path.join(dir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    const replacements = {};

    if (manifest.assetsNeeded?.heroImage) {
      const file = path.join(assetsDir, "hero.png");
      await generateImageToFile({ prompt: manifest.assetsNeeded.heroImage, outFile: file });
      // force RELATIVE path so it works under /preview/<id>/build/...
      replacements["HERO_IMAGE"] = "./assets/hero.png";
    }

    const imgs = Array.isArray(manifest.assetsNeeded?.projectImages)
      ? manifest.assetsNeeded.projectImages.slice(0, 3)
      : [];

    for (let i = 0; i < imgs.length; i++) {
      const out = path.join(assetsDir, `project_${i + 1}.png`);
      await generateImageToFile({ prompt: imgs[i], outFile: out });
      replacements[`PROJECT_${i + 1}_IMG`] = `./assets/project_${i + 1}.png`;
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
    textModel: process.env.TEXT_MODEL || "gemini-2.0-flash",
    imageModel: process.env.IMAGE_MODEL || "gemini-2.5-flash-image",
    pid: process.pid
  });
});

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});