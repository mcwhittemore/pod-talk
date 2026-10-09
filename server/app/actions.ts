"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { one, query } from "@/lib/db";
import { addFeed, refreshFeed } from "@/lib/feeds";
import { addEpisodeToQueue } from "@/lib/queue";
import { WEBHOOK_EVENTS, deliver, emit } from "@/lib/webhooks";
import { isUuid } from "@/lib/http";

async function guard() {
  if (!(await isLoggedIn())) redirect("/login");
}

export async function removeQueueItem(formData: FormData) {
  await guard();
  const id = String(formData.get("id") ?? "");
  if (isUuid(id)) await query("DELETE FROM queue_items WHERE id = $1", [id]);
  revalidatePath("/");
}

export async function addFeedAction(formData: FormData) {
  await guard();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) redirect("/feeds?error=" + encodeURIComponent("URL is required"));
  try {
    const { feed } = await addFeed(url);
    revalidatePath("/feeds");
    redirect(`/feeds/${feed.id}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // next redirect
    redirect("/feeds?error=" + encodeURIComponent(e instanceof Error ? e.message : String(e)));
  }
}

export async function refreshFeedAction(formData: FormData) {
  await guard();
  const id = String(formData.get("id") ?? "");
  if (isUuid(id)) {
    try {
      await refreshFeed(id);
    } catch (e) {
      console.error("refresh failed", e);
    }
  }
  revalidatePath(`/feeds/${id}`);
  revalidatePath("/feeds");
}

export async function deleteFeedAction(formData: FormData) {
  await guard();
  const id = String(formData.get("id") ?? "");
  if (isUuid(id)) await query("DELETE FROM feeds WHERE id = $1", [id]);
  revalidatePath("/feeds");
  redirect("/feeds");
}

export async function enqueueEpisodeAction(formData: FormData) {
  await guard();
  const episodeId = String(formData.get("episode_id") ?? "");
  const feedId = String(formData.get("feed_id") ?? "");
  if (isUuid(episodeId)) {
    const item = await addEpisodeToQueue(episodeId);
    if (item) await emit("queue.item.added", item);
  }
  revalidatePath("/");
  if (isUuid(feedId)) revalidatePath(`/feeds/${feedId}`);
}

export async function addWebhookAction(formData: FormData) {
  await guard();
  const url = String(formData.get("url") ?? "").trim();
  const secret = String(formData.get("secret") ?? "");
  const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!url) redirect("/webhooks?error=" + encodeURIComponent("URL is required"));
  await query("INSERT INTO webhooks (url, secret, events) VALUES ($1, $2, $3)", [url, secret, events]);
  revalidatePath("/webhooks");
  redirect("/webhooks");
}

export async function deleteWebhookAction(formData: FormData) {
  await guard();
  const id = String(formData.get("id") ?? "");
  if (isUuid(id)) await query("DELETE FROM webhooks WHERE id = $1", [id]);
  revalidatePath("/webhooks");
}

export async function testWebhookAction(formData: FormData) {
  await guard();
  const id = String(formData.get("id") ?? "");
  if (isUuid(id)) {
    const hook = await one<{ id: string; url: string; secret: string; events: string[]; active: boolean }>(
      "SELECT id, url, secret, events, active FROM webhooks WHERE id = $1",
      [id],
    );
    if (hook) await deliver(hook, "webhook.test", { message: "Hello from Pod Talk", webhook_id: hook.id });
  }
  revalidatePath("/webhooks");
}
