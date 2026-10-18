import { HugeiconsIcon } from "@hugeicons/react";
// Each icon is imported from its own file instead of the package index. The index of
// @hugeicons/core-free-icons names some files with the wrong letter case (Grid2x2… vs Grid2X2…), which
// works on Windows and macOS but fails the build on Linux, where Vercel builds.
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import House01Icon from "@hugeicons/core-free-icons/House01Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import QrCodeIcon from "@hugeicons/core-free-icons/QrCodeIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import UserSettings01Icon from "@hugeicons/core-free-icons/UserSettings01Icon";

const icons = { home: House01Icon, calendar: Calendar03Icon, users: UserSettings01Icon, settings: Settings01Icon, menu: Menu01Icon, logout: Logout01Icon, add: Add01Icon, left: ArrowLeft01Icon, right: ArrowRight01Icon, close: Cancel01Icon, bell: Notification01Icon, qr: QrCodeIcon, download: Download01Icon };
export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return <HugeiconsIcon icon={icons[name]} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
