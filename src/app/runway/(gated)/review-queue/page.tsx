import { listReviewQueue, type ReviewQueueItem } from "@/lib/runway/review-queue";
import { withRunwayRetry } from "@/lib/runway/retry";
import { ReviewRowActions } from "./review-row-actions";

export const metadata = {
  title: "Review queue, Runway",
};

export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function statusLine(item: ReviewQueueItem): string {
  if (!item.status) return "Pending";
  const word = item.status === "approved" ? "Approved" : "Dismissed";
  const when = item.resolvedAt ? ` on ${WHEN.format(item.resolvedAt)}` : "";
  return `${word} by ${item.resolvedBy ?? "unknown"}${when}`;
}

function QueueRow({ item }: { item: ReviewQueueItem }) {
  return (
    <li
      data-testid={`review-queue-row-${item.id}`}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-zinc-900">{item.summary}</p>
        <span className={item.status ? "text-sm text-zinc-500" : "text-sm font-medium text-amber-700"}>
          {statusLine(item)}
        </span>
      </div>
      {item.reason ? (
        <p className="text-sm text-zinc-700">
          <span className="text-zinc-500">Why it was held: </span>
          <span>{item.reason}</span>
        </p>
      ) : null}
      {item.fields.length > 0 ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {item.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-zinc-500">{f.label}</dt>
              <dd className="break-words text-zinc-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="text-xs text-zinc-500">
        Run <code>{item.runId}</code>, arrived {WHEN.format(item.createdAt)}
      </p>
      {item.status ? null : <ReviewRowActions id={item.id} />}
    </li>
  );
}

export default async function ReviewQueuePage() {
  // No catch: a failed read must error, never render as an empty queue.
  const items = await withRunwayRetry(() => listReviewQueue(), "ReviewQueuePage:list");
  const pending = items.filter((i) => !i.status).length;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Sheet sync review queue</h1>
        <p className="text-sm text-zinc-600">
          Changes the sheet sync held for a person to check. Approving marks a change approved; the data
          pipeline applies it later. Dismissing marks it resolved without any change.
        </p>
        <p className="text-sm text-zinc-600">{pending} pending</p>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">No held changes. The sheet sync has not queued anything.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
