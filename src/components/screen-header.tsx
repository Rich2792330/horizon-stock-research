export function ScreenHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h1 className="text-[17px] font-semibold tracking-tight text-fg">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-fg-muted">
          {subtitle}
        </p>
      )}
    </div>
  );
}
