import { XMLParser } from "fast-xml-parser";

export interface ParsedEpisode {
  guid: string;
  title: string;
  description: string | null;
  audio_url: string | null;
  image_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
}

export interface ParsedFeed {
  title: string | null;
  image_url: string | null;
  episodes: ParsedEpisode[];
}

type Any = Record<string, unknown>;

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Any;
    if ("#text" in o) return text(o["#text"]);
    if ("@_href" in o) return text(o["@_href"]);
    if ("@_url" in o) return text(o["@_url"]);
  }
  return null;
}

function attr(v: unknown, name: string): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return attr(v[0], name);
  if (typeof v === "object") return text((v as Any)["@_" + name]);
  return null;
}

export function parseDuration(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return Math.round(sec);
}

function toIso(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeedXml(xml: string): ParsedFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "#cdata",
    textNodeName: "#text",
    removeNSPrefix: false,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as Any;
  const channel = ((doc.rss as Any)?.channel ?? doc.channel ?? (doc.feed as Any)) as Any | undefined;
  if (!channel) throw new Error("not an RSS feed");

  const cdataOrText = (v: unknown): string | null => {
    if (v && typeof v === "object" && !Array.isArray(v) && "#cdata" in (v as Any)) {
      return text((v as Any)["#cdata"]);
    }
    return text(v);
  };

  const feedImage =
    attr(channel["itunes:image"], "href") ?? text((channel.image as Any)?.url) ?? null;

  const rawItems = channel.item ?? channel.entry ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]) as Any[];
  const episodes: ParsedEpisode[] = [];
  for (const it of items) {
    const audio = attr(it.enclosure, "url") ?? attr(it["media:content"], "url");
    const title = cdataOrText(it.title) ?? "(untitled)";
    const guid = cdataOrText(it.guid) ?? audio ?? title;
    episodes.push({
      guid,
      title,
      description: cdataOrText(it["itunes:summary"]) ?? cdataOrText(it.description) ?? null,
      audio_url: audio,
      image_url: attr(it["itunes:image"], "href") ?? feedImage,
      duration_sec: parseDuration(it["itunes:duration"]),
      published_at: toIso(it.pubDate) ?? toIso(it.published) ?? null,
    });
  }
  return { title: cdataOrText(channel.title), image_url: feedImage, episodes };
}

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await fetch(url, {
    headers: { "user-agent": "PodTalk/0.1 (+https://github.com/mcwhittemore/pod-talk)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`feed fetch failed: HTTP ${res.status}`);
  return parseFeedXml(await res.text());
}
