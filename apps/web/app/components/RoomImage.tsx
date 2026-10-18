import Image from "next/image";
import { assetUrl } from "../../lib/api";

type RoomImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Tell the browser how wide the image is drawn so it downloads a right-sized copy. */
  sizes: string;
  /** Set for images above the fold so they load first. */
  priority?: boolean;
};

/**
 * Fills its positioned parent. Photos bundled with the app (/rooms/...) go through the Next.js optimizer (resized,
 * AVIF/WebP, cached). A photo uploaded in the browser is already a small data URL, and an external URL typed by an
 * admin cannot be optimized, so both are shown as they are.
 */
export function RoomImage({ src, alt, className, sizes, priority = false }: RoomImageProps) {
  const url = assetUrl(src);
  if (!url.startsWith("/") || url.startsWith("//")) {
    // eslint-disable-next-line @next/next/no-img-element -- a data URL or an arbitrary host, not usable by the optimizer
    return <img className={className} src={url} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" />;
  }
  return <Image className={className} src={url} alt={alt} fill sizes={sizes} priority={priority} />;
}
