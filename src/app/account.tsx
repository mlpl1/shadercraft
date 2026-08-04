import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { type ProgressRemoteErrorKind, type SyncStatus, useSyncStatus } from "../context/sync-context";
import { isCloudSyncEnabled } from "../data/supabase/client";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

type AuthAction = "sign-in" | "sign-up";
type PendingAction = AuthAction | "sign-out" | null;

/** Client-side validation only — never reaches the auth service until this passes, matching the
 * validation-error state the task brief calls out as distinct from a server-reported auth error. */
function validateCredentials(email: string, password: string): string | null {
  if (!email.trim() || !password) {
    return "Enter an email and a password.";
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return "Enter a valid email address.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case "idle":
      return "Up to date";
    case "syncing":
      return "Syncing…";
    case "attention":
      return "Needs attention";
    case "offline":
      return "Waiting to retry";
  }
}

/** A safe, pre-classified description — never the raw Supabase/network payload behind it. */
function describeSyncErrorKind(kind: ProgressRemoteErrorKind): string {
  switch (kind) {
    case "auth":
      return "Your session needs to be renewed. Sign out and back in to keep syncing.";
    case "transport":
      return "Could not reach the sync server. It will keep retrying automatically.";
    case "rejected":
      return "The last sync attempt was rejected by the server.";
  }
}

export default function AccountScreen() {
  const router = useRouter();
  const cloudSyncEnabled = isCloudSyncEnabled();
  const auth = useAuth();
  const sync = useSyncStatus();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<{ action: AuthAction; message: string } | null>(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Tracks only the *transition* into "idle", so a fresh mount that happens to already be idle (no
  // pass has run this session) reads as "not yet", not as a fabricated sync that never happened.
  const previousSyncStatusRef = useRef(sync.status);
  useEffect(() => {
    if (previousSyncStatusRef.current !== "idle" && sync.status === "idle") {
      setLastSyncedAt(new Date());
    }
    previousSyncStatusRef.current = sync.status;
  }, [sync.status]);

  const isBusy = pendingAction !== null;

  const submit = async (action: AuthAction) => {
    if (isBusy) return;

    setAuthError(null);
    const validation = validateCredentials(email, password);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError(null);
    setPendingAction(action);

    try {
      if (action === "sign-in") {
        await auth.signInWithPassword(email.trim(), password);
      } else {
        const result = await auth.signUpWithPassword(email.trim(), password);
        setPendingConfirmationEmail(result.kind === "confirm-email" ? result.email : null);
      }
      setPassword("");
    } catch (caughtError) {
      setAuthError({
        action,
        message: caughtError instanceof Error ? caughtError.message : "Something went wrong. Try again.",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleSignOut = async () => {
    setSignOutError(null);
    setPendingAction("sign-out");
    try {
      await auth.signOut();
    } catch (caughtError) {
      setSignOutError(
        caughtError instanceof Error ? caughtError.message : "Could not sign out. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const confirmSignOut = () => {
    Alert.alert(
      "Sign out?",
      "You'll be signed out of this account. Your offline progress on this device stays available, and local-only progress resumes right away.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void handleSignOut();
          },
          style: "destructive",
          text: "Sign out",
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <AppIcon
              color={Colors.text}
              fallback="‹"
              name={{ android: "arrow_back", ios: "chevron.left", web: "arrow_back" }}
              size={22}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Cross-device sync</Text>
            <Text style={styles.title}>Account</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          {!cloudSyncEnabled ? (
            <LocalOnlyPanel />
          ) : auth.session === undefined ? (
            <Text style={styles.loadingCaption}>Loading account…</Text>
          ) : auth.session ? (
            <AuthenticatedPanel
              email={auth.session.email}
              isSigningOut={pendingAction === "sign-out"}
              lastSyncedAt={lastSyncedAt}
              onRetrySync={sync.retrySync}
              onSignOut={confirmSignOut}
              signOutError={signOutError}
              sync={sync}
            />
          ) : (
            <SignInPanel
              authError={authError}
              email={email}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onSignIn={() => {
                void submit("sign-in");
              }}
              onSignUp={() => {
                void submit("sign-up");
              }}
              password={password}
              pendingAction={pendingAction}
              pendingConfirmationEmail={pendingConfirmationEmail}
              validationError={validationError}
            />
          )}

          {auth.error ? (
            <View style={styles.noticeBanner}>
              <Text style={styles.noticeText}>
                Could not verify your account profile: {auth.error.message}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function LocalOnlyPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelEyebrow}>Local only</Text>
      <Text style={styles.panelTitle}>Cloud sync is off</Text>
      <Text style={styles.panelBody}>
        This build of Shadercraft runs fully offline. Your progress is saved on this device only —
        nothing is sent anywhere, and there is no account to sign in to.
      </Text>
    </View>
  );
}

type AuthenticatedPanelProps = {
  email: string;
  isSigningOut: boolean;
  lastSyncedAt: Date | null;
  onRetrySync: () => void;
  onSignOut: () => void;
  signOutError: string | null;
  sync: { status: SyncStatus; pending: number; errorKind: ProgressRemoteErrorKind | null };
};

function AuthenticatedPanel({
  email,
  isSigningOut,
  lastSyncedAt,
  onRetrySync,
  onSignOut,
  signOutError,
  sync,
}: AuthenticatedPanelProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelEyebrow}>Signed in</Text>
      <Text style={styles.accountEmail}>{email}</Text>

      <View style={styles.syncCard}>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Status</Text>
          <Text style={styles.syncValue}>{syncStatusLabel(sync.status)}</Text>
        </View>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Pending changes</Text>
          <Text style={styles.syncValue}>{sync.pending}</Text>
        </View>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Last successful sync</Text>
          <Text style={styles.syncValue}>
            {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : "Not yet this session"}
          </Text>
        </View>

        {sync.errorKind && sync.status !== "idle" ? (
          <Text style={styles.syncNotice}>{describeSyncErrorKind(sync.errorKind)}</Text>
        ) : null}

        {sync.status === "attention" ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetrySync}
            style={({ pressed }) => [styles.retrySyncButton, pressed && styles.pressed]}
          >
            <Text style={styles.retrySyncLabel}>Retry sync</Text>
          </Pressable>
        ) : null}
      </View>

      {signOutError ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>Could not sign out</Text>
          <Text style={styles.errorBody}>{signOutError}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isSigningOut }}
        disabled={isSigningOut}
        onPress={onSignOut}
        style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
      >
        <Text style={styles.signOutLabel}>{isSigningOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </View>
  );
}

type SignInPanelProps = {
  authError: { action: AuthAction; message: string } | null;
  email: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSignIn: () => void;
  onSignUp: () => void;
  password: string;
  pendingAction: PendingAction;
  pendingConfirmationEmail: string | null;
  validationError: string | null;
};

function SignInPanel({
  authError,
  email,
  onEmailChange,
  onPasswordChange,
  onSignIn,
  onSignUp,
  password,
  pendingAction,
  pendingConfirmationEmail,
  validationError,
}: SignInPanelProps) {
  const isBusy = pendingAction !== null;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelEyebrow}>Optional</Text>
      <Text style={styles.panelTitle}>Sync progress across devices</Text>
      <Text style={styles.panelBody}>
        Signing in keeps completed lessons in step across devices. It is optional — Shadercraft keeps
        working fully offline either way.
      </Text>

      {pendingConfirmationEmail ? (
        <View style={styles.successBanner}>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successBody}>
            We sent a confirmation link to {pendingConfirmationEmail}. Confirm it, then sign in below.
          </Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Email</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          editable={!isBusy}
          keyboardType="email-address"
          onChangeText={onEmailChange}
          placeholder="you@example.com"
          placeholderTextColor={Colors.textSubtle}
          style={styles.input}
          value={email}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Password</Text>
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          editable={!isBusy}
          onChangeText={onPasswordChange}
          placeholder="••••••••"
          placeholderTextColor={Colors.textSubtle}
          secureTextEntry
          style={styles.input}
          value={password}
        />
      </View>

      {validationError ? <Text style={styles.fieldError}>{validationError}</Text> : null}

      {authError ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>
            {authError.action === "sign-in" ? "Could not sign in" : "Could not create account"}
          </Text>
          <Text style={styles.errorBody}>{authError.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={onSignIn}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.pressed,
          isBusy && styles.disabledButton,
        ]}
      >
        <Text style={styles.primaryButtonLabel}>
          {pendingAction === "sign-in" ? "Signing in…" : "Sign in"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        disabled={isBusy}
        onPress={onSignUp}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && styles.pressed,
          isBusy && styles.disabledButton,
        ]}
      >
        <Text style={styles.secondaryButtonLabel}>
          {pendingAction === "sign-up" ? "Creating account…" : "Create account"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, marginLeft: Spacing.md },
  eyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: { marginTop: 2, color: Colors.text, fontSize: 20, fontWeight: "900" },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.lg,
  },
  loadingCaption: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginTop: Spacing.xxl,
  },
  panel: {
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.md,
  },
  panelEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  panelTitle: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  panelBody: { color: Colors.textMuted, fontSize: 14, lineHeight: 21 },
  accountEmail: { color: Colors.accent, fontSize: 17, fontWeight: "800" },
  field: { gap: Spacing.xs },
  fieldLabel: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    color: Colors.text,
    fontSize: 15,
  },
  fieldError: { color: Colors.coral, fontSize: 12, lineHeight: 18 },
  successBanner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
    gap: Spacing.xs,
  },
  successTitle: { color: Colors.accent, fontSize: 13, fontWeight: "900" },
  successBody: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  errorPanel: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.coral,
    backgroundColor: Colors.surface,
    gap: Spacing.xs,
  },
  errorTitle: { color: Colors.coral, fontSize: 13, fontWeight: "900" },
  errorBody: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  primaryButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonLabel: { color: Colors.background, fontSize: 15, fontWeight: "900" },
  secondaryButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonLabel: { color: Colors.text, fontSize: 15, fontWeight: "800" },
  disabledButton: { opacity: 0.55 },
  syncCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  syncRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  syncLabel: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 10,
    textTransform: "uppercase",
  },
  syncValue: { color: Colors.text, fontFamily: "monospace", fontSize: 12, fontWeight: "800" },
  syncNotice: { color: Colors.coral, fontSize: 12, lineHeight: 18 },
  retrySyncButton: {
    marginTop: Spacing.xs,
    minHeight: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.coral,
    alignItems: "center",
    justifyContent: "center",
  },
  retrySyncLabel: { color: Colors.coral, fontSize: 13, fontWeight: "800" },
  signOutButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutLabel: { color: Colors.text, fontSize: 14, fontWeight: "800" },
  noticeBanner: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  noticeText: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.72 },
});
