import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon, Cancel01Icon, Download01Icon, House01Icon, Logout01Icon, Menu01Icon, Notification01Icon, QrCodeIcon, Settings01Icon, UserSettings01Icon } from "@hugeicons/core-free-icons";

const icons = { home: House01Icon, calendar: Calendar03Icon, users: UserSettings01Icon, settings: Settings01Icon, menu: Menu01Icon, logout: Logout01Icon, add: Add01Icon, left: ArrowLeft01Icon, right: ArrowRight01Icon, close: Cancel01Icon, bell: Notification01Icon, qr: QrCodeIcon, download: Download01Icon };
export type IconName = keyof typeof icons;

export function Icon({ name, size = 18, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return <HugeiconsIcon icon={icons[name]} size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
