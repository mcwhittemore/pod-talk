// Tiny local sink for testing webhook delivery: logs the body and returns 200.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  console.log(
    `[webhook-sink] event=${req.headers.get("x-podtalk-event")} sig=${req.headers.get("x-podtalk-signature")?.slice(0, 20)}... body=${body.slice(0, 300)}`,
  );
  return Response.json({ received: true });
}
