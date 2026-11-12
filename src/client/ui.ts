import type { QueryInfo, StockStatus } from "../shared/types.js";

const TOAST_DURATION_MS = 3500;
const TOAST_FADE_MS = 200;
const MINUTE_MS = 60 * 1000;

type ElementType<T extends Element> = { new (): T; prototype: T };

export function byId<T extends HTMLElement>(id: string, type: ElementType<T>): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} is missing or is not a ${type.name}`);
  return element;
}

export function formField<T extends Element>(form: HTMLFormElement, name: string, type: ElementType<T>): T {
  const element = form.elements.namedItem(name);
  if (!(element instanceof type)) throw new Error(`Form field "${name}" is missing`);
  return element;
}

export function checkedValues(form: HTMLFormElement, name: string): string[] {
  return [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value);
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const STATUS_LABELS: Record<StockStatus, string> = {
  green: "Good",
  orange: "Getting low",
  red: "Low",
  "sold-out": "Sold out",
};

export function statusBadge(status: StockStatus): string {
  return `<span class="status-badge status-${status}">${STATUS_LABELS[status]}</span>`;
}

export function swatch(colorHex: string): string {
  return `<span class="swatch" style="--swatch: ${escapeHtml(colorHex)}" aria-hidden="true"></span>`;
}

export function showToast(message: string, kind: "success" | "error" = "success"): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.textContent = message;
  byId("toasts", HTMLElement).append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}

function formatQuery(query: QueryInfo): string {
  const args = [query.filter, query.update, query.document, query.pipeline]
    .filter((arg) => arg !== undefined)
    .map((arg) => JSON.stringify(arg, null, 2));
  const call = `db.${query.collection}.${query.operation}(${args.join(",\n")})`;
  return query.note ? `// ${query.note}\n${call}` : call;
}

export function formatQueries(queries: QueryInfo[]): string {
  return queries.map(formatQuery).join("\n\n");
}

export function queryPanel(queries: QueryInfo[]): string {
  return `
    <details class="query-panel">
      <summary>Show the query</summary>
      <pre>${escapeHtml(formatQueries(queries))}</pre>
    </details>`;
}

function dialogElement(): HTMLDialogElement {
  return byId("dialog", HTMLDialogElement);
}

// Opens the shared dialog with a form. The dialog stays open if onSubmit
// throws, so server validation messages can be shown next to the form.
export function openFormDialog(html: string, onSubmit: (form: HTMLFormElement) => Promise<void>): void {
  const dialog = dialogElement();
  dialog.innerHTML = html;
  const form = dialog.querySelector("form");
  if (!form) throw new Error("Dialog content needs a form");
  const errorBox = dialog.querySelector<HTMLElement>(".dialog-error");
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton) submitButton.disabled = true;
    try {
      await onSubmit(form);
      dialog.close();
    } catch (error) {
      if (errorBox) errorBox.textContent = errorMessage(error);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
  dialog.showModal();
}

export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    openFormDialog(
      `<form class="dialog-form">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-danger">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`,
      async () => {
        confirmed = true;
      },
    );
    dialogElement().addEventListener("close", () => resolve(confirmed), { once: true });
  });
}
