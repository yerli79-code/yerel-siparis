import Image from "next/image";

type PlatformBrandProps = {
  onDark?: boolean;
  className?: string;
  publicVariant?: boolean;
};

export default function PlatformBrand({
  onDark = false,
  className = "",
  publicVariant = false,
}: PlatformBrandProps) {
  if (publicVariant) {
    return (
      <span
        aria-label="Yerel Sipariş"
        className={`platform-brand-shell platform-brand-public ${className}`.trim()}
        role="img"
      >
        <Image
          alt=""
          aria-hidden="true"
          className="platform-brand-public-mark"
          height={96}
          priority
          src="/brand/yerel-siparis-public-mark.svg"
          width={96}
        />
        <span className="platform-brand-public-wordmark">Yerel Sipariş</span>
      </span>
    );
  }

  return (
    <span
      className={`platform-brand-shell ${onDark ? "platform-brand-on-dark" : ""} ${className}`.trim()}
    >
      <Image
        alt="yerelsiparis.com"
        className="platform-brand"
        height={320}
        priority
        src="/brand/yerel-siparis-logo.svg"
        width={1200}
      />
    </span>
  );
}
