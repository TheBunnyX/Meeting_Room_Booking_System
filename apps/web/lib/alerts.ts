// SweetAlert2 is only needed once a dialog opens, so it is loaded on first use instead of with every page.
let swal: Promise<typeof import("sweetalert2").default> | undefined;
function getSwal() {
  return (swal ??= import("sweetalert2").then((module) => module.default));
}

const base = {
  confirmButtonColor: "#151515",
  cancelButtonColor: "#e8e8e8",
  customClass: { popup: "meetinghub-alert" },
};

export async function showSuccess(message: string, title = "Done") {
  return (await getSwal()).fire({ ...base, icon: "success", title, text: message, timer: 2200, showConfirmButton: false });
}

export async function showError(message: string, title = "Something went wrong") {
  return (await getSwal()).fire({ ...base, icon: "error", title, text: message });
}

export async function showInfo(message: string, title = "MeetingHub") {
  return (await getSwal()).fire({ ...base, icon: "info", title, text: message });
}

export async function showPassword(password: string) {
  // Built from DOM nodes so the password is always inserted as text, never parsed as HTML.
  const content = document.createElement("div");
  const code = document.createElement("code");
  code.className = "meetinghub-password";
  code.textContent = password;
  const help = document.createElement("p");
  help.className = "meetinghub-alert-help";
  help.textContent = "Share this password securely. The user must change it after signing in.";
  content.append(code, help);
  return (await getSwal()).fire({ ...base, icon: "success", title: "Temporary password", html: content, confirmButtonText: "Close" });
}

export async function confirmAction(message: string, confirmButtonText = "Confirm") {
  const result = await (await getSwal()).fire({ ...base, icon: "warning", title: "Are you sure?", text: message, showCancelButton: true, confirmButtonText, cancelButtonText: "Cancel", reverseButtons: true });
  return result.isConfirmed;
}

/** Ask for a short written reason. Resolves to null when the dialog is dismissed. */
export async function askReason(title: string, message: string, confirmButtonText: string) {
  const result = await (await getSwal()).fire({
    ...base,
    title,
    text: message,
    input: "textarea",
    inputAttributes: { "aria-label": "Reason", maxlength: "300" },
    inputPlaceholder: "Reason",
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: "Cancel",
    reverseButtons: true,
    inputValidator: (value) => (value.trim().length < 2 ? "Please give a short reason." : undefined),
  });
  return result.isConfirmed ? String(result.value).trim() : null;
}

/** For a booking that repeats weekly: cancel just this meeting, or every remaining one? */
export async function chooseCancelScope(): Promise<"one" | "series" | null> {
  const result = await (await getSwal()).fire({
    ...base,
    icon: "warning",
    title: "Cancel a weekly booking",
    text: "This meeting repeats every week. What would you like to cancel?",
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "This meeting only",
    denyButtonText: "All remaining meetings",
    denyButtonColor: "#b3261e",
    cancelButtonText: "Keep",
  });
  if (result.isConfirmed) return "one";
  return result.isDenied ? "series" : null;
}
