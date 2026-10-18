import Image from "next/image";
import { assetUrl } from "../../lib/api";

// Hosts next.config.mjs lets the image optimizer fetch from.
const STORED_IMAGE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;

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
 * Fills its positioned parent. Bundled photos and uploaded Vercel Blob images go through the Next.js
 * optimizer (resized, AVIF/WebP, cached); an arbitrary external URL entered by an admin is shown as is.
 */
export function RoomImage({ src, alt, className, sizes, priority = false }: RoomImageProps) {
  const url = assetUrl(src);
  const optimizable = (url.startsWith("/") && !url.startsWith("//")) || STORED_IMAGE.test(url);
  if (!optimizable) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary host, not allowed for the optimizer
    return <img className={className} src={url} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" />;
  }
  return <Image className={className} src={url} alt={alt} fill sizes={sizes} priority={priority} />;
}
