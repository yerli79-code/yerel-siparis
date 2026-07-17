import Image from "next/image";

type PlatformBrandProps = {
  onDark?: boolean;
  className?: string;
};

export default function PlatformBrand({
  onDark = false,
  className = "",
}: PlatformBrandProps) {
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
