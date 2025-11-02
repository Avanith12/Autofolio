import { useState } from "react";
import "./App.css";

export default function App() {
  const [mode, setMode] = useState("prompt");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [email, setEmail] = useState("");
  const [skills, setSkills] = useState("");
  const [projectsText, setProjectsText] = useState("");
  const [accent, setAccent] = useState("#22D3EE");
  const [template, setTemplate] = useState("modern");
  const [log, setLog] = useState([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  function parseProjects(text) {
    return text
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const [ptitle = "", desc = "", tags = "", link = ""] = l.split("|").map(s => s.trim());
        return { title: ptitle, desc, tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [], link };
      });
  }

  function buildBody() {
    if (mode === "prompt") return { prompt };
    const payload = {
      name,
      title,
      tagline,
      about,
      email,
      accent,
      template,
      skills: skills ? skills.split(",").map(s => s.trim()).filter(Boolean) : [],
      projects: parseProjects(projectsText)
    };
    return payload;
  }

  async function generate() {
    const push = (m) => setLog(L => [...L, m]);
    setLog(["Starting…"]);
    setPreviewUrl("");
    setDownloadUrl("");
    try {
      push("Generating spec…");
      let r = await fetch("http://localhost:8787/api/generate-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      let a = await r.json();
      if (!a.ok) throw new Error(a.error || "spec failed");

      push("Generating assets…");
      r = await fetch("http://localhost:8787/api/generate-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id }),
      });
      let b = await r.json();
      if (!b.ok) throw new Error(b.error || "assets failed");

      push("Building site…");
      r = await fetch("http://localhost:8787/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id }),
      });
      let c = await r.json();
      if (!c.ok) throw new Error(c.error || "build failed");

      setPreviewUrl(c.previewUrl);
      setDownloadUrl(c.downloadUrl);
      push("Done.");
    } catch (e) {
      setLog(L => [...L, `Error: ${e.message}`]);
    }
  }

  return (
    <div className="app">
      <h1>AI Website Builder</h1>

      <div className="layout">
        <section className="left">
          <label className="toggle">
            <input
              type="checkbox"
              checked={mode === "form"}
              onChange={() => setMode(m => (m === "prompt" ? "form" : "prompt"))}
            />
            Use structured form
          </label>

          {mode === "prompt" ? (
            <>
              <textarea
                className="textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the site. Example: Dark portfolio for a web developer with hero, about, skills, 3 projects and a contact section."
              />
              <span className="help">Switch to the form for precise control over sections.</span>
            </>
          ) : (
            <>
              <div className="hstack">
                <input className="input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
                <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <input className="input" placeholder="Tagline" value={tagline} onChange={e => setTagline(e.target.value)} />
              <textarea className="textarea" placeholder="About (short paragraph)" value={about} onChange={e => setAbout(e.target.value)} />
              <div className="hstack">
                <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                <input className="color" type="color" value={accent} onChange={e => setAccent(e.target.value)} />
              </div>
              <div className="hstack">
                <input className="input" placeholder="Skills (comma separated)" value={skills} onChange={e => setSkills(e.target.value)} />
                <select className="select" value={template} onChange={e => setTemplate(e.target.value)}>
                  <option value="modern">modern</option>
                  <option value="serif">serif</option>
                  <option value="dark">dark</option>
                  <option value="grid">grid</option>
                </select>
              </div>
              <textarea
                className="textarea"
                placeholder="Projects, one per line as: Title | Description | tag1, tag2 | https://link"
                value={projectsText}
                onChange={e => setProjectsText(e.target.value)}
              />
            </>
          )}

          <button className="button" onClick={generate}>Generate</button>

          <h3 className="progressTitle">Progress</h3>
          <div className="progressBox">{log.join("\n")}</div>

          {downloadUrl && (
            <p style={{ marginTop: 10 }}>
              <a href={downloadUrl}>Download ZIP</a>
            </p>
          )}
        </section>

        <section className="right">
          <h3 className="previewTitle">Preview</h3>
          <div className="previewWrapper">
            {previewUrl ? (
              <iframe title="preview" src={previewUrl} className="previewFrame" />
            ) : (
              <div style={{ padding: 16, color: "#aaa" }}>
                Your generated site will appear here.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
