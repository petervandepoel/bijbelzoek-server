// server/routes/ai.js
import express from "express";
import fetch from "node-fetch";
import { OpenAI } from "openai";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: format RSS/News entries
async function fetchNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=nl&gl=NL&ceid=NL:nl`;
  const res = await fetch(url);
  const text = await res.text();
  const matches = [...text.matchAll(/<item><title>(.*?)<\/title>.*?<link>(.*?)<\/link>/gs)];
  return matches.slice(0,5).map(m => ({ title: m[1], url: m[2], source: new URL(m[2]).hostname }));
}

async function fetchMedia(query) {
  // duckduckgo search as fallback (YouTube links)
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query + " site:youtube.com")}`;
  const res = await fetch(url);
  const html = await res.text();
  const links = [...html.matchAll(/href="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)/g)]
    .map(m => m[1]);
  return [...new Set(links)].slice(0,5).map(l => ({ url: l, source: "youtube.com" }));
}

// Compose structured JSON (no stream)
router.post("/compose", async (req,res) => {
  try {
    const { prompt } = req.body;
    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role:"system", content:"Je bent een bijbelstudie-assistent."},{ role:"user", content: prompt}],
      response_format: { type: "json_object" }
    });
    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Compose streaming prose (for live preview)
router.post("/compose/stream", async (req,res) => {
  try {
    const { prompt } = req.body;
    const stream = await client.chat.completions.stream({
      model: "gpt-4.1",
      messages: [{ role:"system", content:"Schrijf leesbaar proza (geen JSON)."},
                 { role:"user", content: prompt }],
    });

    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.flushHeaders();

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if(content){
        res.write(`data: ${JSON.stringify(content)}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// News deeplinks
router.post("/actueel", async (req,res) => {
  try{
    const { query } = req.body;
    const data = await fetchNews(query);
    res.json({ items: data });
  } catch(err){
    res.status(500).json({ error: err.message });
  }
});

// Media deeplinks
router.post("/media", async (req,res) => {
  try{
    const { query } = req.body;
    const data = await fetchMedia(query);
    res.json({ items: data });
  } catch(err){
    res.status(500).json({ error: err.message });
  }
});

export default router;
