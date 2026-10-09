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

const MAX_DURATION_SEC = 7 * 24 * 3600;

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = text(x);
      if (t) return t;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Any;
    if ("#cdata" in o) return text(o["#cdata"]);
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

const asList = (v: unknown): Any[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).filter((x): x is Any => !!x && typeof x === "object");

/** Accepts "3600", "45.5", "mm:ss", "h:mm:ss" (and "h:mm:ss.s"). Rejects negatives, >3 parts, and absurd values. */
export function parseDuration(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  let sec: number;
  if (/^\d+(\.\d+)?$/.test(s)) {
    sec = Number(s);
  } else {
    const parts = s.split(":");
    if (parts.length > 3 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p.trim()))) return null;
    sec = 0;
    for (const p of parts) sec = sec * 60 + Number(p);
  }
  sec = Math.round(sec);
  return sec >= 0 && sec <= MAX_DURATION_SEC ? sec : null;
}

function toIso(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Resolves a possibly relative URL against the feed URL; null when it is not an http(s) URL. */
function resolveUrl(raw: string | null, base: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

const isAudioType = (type: string | null): boolean => !!type && /^audio\//i.test(type);

/** Picks the audio URL of an item: enclosure, then audio media:content, then Atom link rel=enclosure. */
function pickAudio(it: Any): string | null {
  const enclosures = asList(it.enclosure);
  const audioEnclosure = enclosures.find((e) => isAudioType(attr(e, "type")));
  const anyEnclosure = enclosures.find((e) => attr(e, "url") && !/^(image|video)\//i.test(attr(e, "type") ?? ""));
  const media = asList(it["media:content"]);
  const audioMedia = media.find((m) => isAudioType(attr(m, "type")) || attr(m, "medium") === "audio");
  const atomLink = asList(it.link).find((l) => attr(l, "rel") === "enclosure" && (isAudioType(attr(l, "type")) || !attr(l, "type")));
  return (
    attr(audioEnclosure, "url") ??
    attr(anyEnclosure, "url") ??
    attr(audioMedia, "url") ??
    attr(atomLink, "href") ??
    null
  );
}

export function parseFeedXml(xml: string, feedUrl?: string): ParsedFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "#cdata",
    textNodeName: "#text",
    removeNSPrefix: false,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as Any;
  const rdf = doc["rdf:RDF"] as Any | undefined;
  const channel = ((doc.rss as Any)?.channel ?? doc.channel ?? (doc.feed as Any) ?? rdf?.channel) as Any | undefined;
  if (!channel) throw new Error("not an RSS feed");

  const feedImage =
    resolveUrl(attr(channel["itunes:image"], "href") ?? text((channel.image as Any)?.url), feedUrl) ?? null;

  // RSS 2.0: channel.item; Atom: feed.entry; RSS 1.0: rdf:RDF.item (siblings of channel).
  const rawItems = channel.item ?? channel.entry ?? rdf?.item ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]) as Any[];
  const episodes: ParsedEpisode[] = [];
  for (const it of items) {
    const audio = resolveUrl(pickAudio(it), feedUrl);
    const title = text(it.title) ?? "(untitled)";
    const guid = text(it.guid) ?? text(it.id) ?? audio ?? title;
    episodes.push({
      guid,
      title,
      description: text(it["itunes:summary"]) ?? text(it.description) ?? text(it.summary) ?? null,
      audio_url: audio,
      image_url: resolveUrl(attr(it["itunes:image"], "href"), feedUrl) ?? feedImage,
      duration_sec: parseDuration(it["itunes:duration"]),
      published_at: toIso(it.pubDate) ?? toIso(it.published) ?? toIso(it.updated) ?? toIso(it["dc:date"]) ?? null,
    });
  }
  return { title: text(channel.title), image_url: feedImage, episodes };
}

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await fetch(url, {
    headers: { "user-agent": "PodTalk/0.1 (+https://github.com/mcwhittemore/pod-talk)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`feed fetch failed: HTTP ${res.status}`);
  // Resolve relative URLs against the final URL after redirects.
  return parseFeedXml(await res.text(), res.url || url);
}
