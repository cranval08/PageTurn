import { isGoogleConfigured } from "../lib/google/config";
import { useAuth } from "../store/auth";
import { Menu } from "./Menu";

export function Avatar({ name, picture, size = 32 }: { name: string; picture?: string; size?: number }) {
  if (picture) {
    return (
      <img
        src={picture}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full bg-accent font-medium text-white"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** DRV-1: "Sign in with Google", or the signed-in avatar with name and Sign out. */
export function AccountButton() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const signIn = useAuth((s) => s.signIn);
  const signOut = useAuth((s) => s.signOut);

  if (!isGoogleConfigured()) return null;

  if (!user) {
    return (
      <button
        type="button"
        className="btn-secondary whitespace-nowrap px-3 sm:px-4"
        aria-label={status === "signing-in" ? undefined : "Sign in with Google"}
        disabled={status === "signing-in"}
        onClick={() => void signIn().catch(() => {})}
      >
        {status === "signing-in" ? (
          "Signing in…"
        ) : (
          <>
            Sign in<span className="hidden sm:inline">&nbsp;with Google</span>
          </>
        )}
      </button>
    );
  }

  return (
    <Menu
      label="Account"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5"
          aria-label={`Google account: ${user.name}`}
          data-testid="account-button"
        >
          <Avatar name={user.name} picture={user.picture} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3">
            <Avatar name={user.name} picture={user.picture} size={40} />
            <div className="min-w-0">
              <p className="truncate font-medium" data-testid="account-name">
                {user.name}
              </p>
              <p className="truncate text-sm text-ink-muted">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              void signOut();
            }}
          >
            Sign out
          </button>
        </>
      )}
    </Menu>
  );
}
