/**
 * reminders-panel.test.tsx
 * Settings → Reminders and Home's install hint, in the browser: what each
 * kind of device is offered (an iPhone in Safari is told to install first, an
 * installed app is told it is installed), turning the reminder on posts the
 * browser's own subscription, and the hint shows only on iOS in a tab.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { RemindersPanel } from "~/components/reminders/reminders-panel";
import { InstallHint, INSTALL_HINT_KEY } from "~/components/reminders/install-hint";

beforeAll(() => {
  initI18n("en");
});

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const push = { public_key: "BKz" + "A".repeat(84), hour: 7, timezone: "Asia/Ho_Chi_Minh", endpoints: [] as string[] };

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[] = []) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const body: Post = {};
          for (const [k, v] of (await request.formData()).entries()) body[k] = String(v);
          posts.push(body);
          return { intent: body.intent, ok: true };
        },
      },
      { path: "/settings/reminders", element: <p>Reminders page</p> },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function asDevice(opts: { ua?: string; standalone?: boolean; push?: boolean; subscribed?: string | null }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(opts.ua ?? "Mozilla/5.0 (X11; Linux x86_64) Chrome/140");
  window.matchMedia = ((q: string) => ({ matches: q.includes("standalone") && !!opts.standalone })) as never;
  if (!opts.push) {
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(navigator, "serviceWorker");
    return;
  }
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  let current = opts.subscribed ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => (current = subscription)),
  };
  Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
  Object.defineProperty(window, "Notification", {
    value: Object.assign(function Notification() {}, { permission: "default", requestPermission: vi.fn().mockResolvedValue("granted") }),
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({ pushManager }), register: vi.fn().mockResolvedValue({}) },
    configurable: true,
  });
  return pushManager;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Settings → Reminders", () => {
  it("tells an iPhone in Safari to put AnyLearn on the Home Screen first", async () => {
    asDevice({ ua: IPHONE });
    routed(<RemindersPanel push={push} pending={false} />);
    expect(await screen.findByText("Tap the Share button.")).toBeInTheDocument();
    expect(screen.getByText(/works once AnyLearn is on your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on in this browser" })).not.toBeInTheDocument();
  });

  it("says an installed app is installed", async () => {
    asDevice({ ua: IPHONE, standalone: true, push: true });
    routed(<RemindersPanel push={push} pending={false} />);
    expect(await screen.findByText("AnyLearn is installed on this device.")).toBeInTheDocument();
  });

  it("turns the reminder on by posting this browser's own subscription", async () => {
    const manager = asDevice({ push: true })!;
    const posts: Post[] = [];
    routed(<RemindersPanel push={push} pending={false} />, posts);
    await userEvent.click(await screen.findByRole("button", { name: "Turn on in this browser" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(manager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const [sent] = posts as [Post];
    expect(sent.intent).toBe("subscribe");
    expect(JSON.parse(sent.subscription ?? "{}").endpoint).toBe(ENDPOINT);
  });

  it("offers to turn it off where it is on, and a test while any browser has it", async () => {
    asDevice({ push: true, subscribed: ENDPOINT });
    routed(<RemindersPanel push={{ ...push, endpoints: [ENDPOINT] }} pending={false} />);
    expect(await screen.findByText("The reminder is on in this browser.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send a test reminder" })).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Ho_Chi_Minh/)).toBeInTheDocument();
  });
});

describe("Home's install hint", () => {
  it("shows on an iPhone in Safari, and stays gone once dismissed", async () => {
    asDevice({ ua: IPHONE });
    const first = routed(<InstallHint />);
    expect(await screen.findByRole("link", { name: "Show me how" })).toHaveAttribute("href", "/settings/reminders");
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe("1");
    first.unmount();
    routed(<InstallHint />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Show me how" })).not.toBeInTheDocument();
  });

  it("does not show on a computer, or in the installed app", async () => {
    asDevice({});
    const a = routed(<InstallHint />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Show me how" })).not.toBeInTheDocument();
    a.unmount();
    asDevice({ ua: IPHONE, standalone: true });
    routed(<InstallHint />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Show me how" })).not.toBeInTheDocument();
  });
});
