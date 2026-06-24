/** pagepin 品牌标(v3）—— 圆角「页面砖」+ 镂空的评论 pin，pin 内两条评论线。
 *  内联 SVG:随处复用、随 currentColor 无关(固定品牌色)、无静态资源往返,Node/Workers 同源。
 *  variant:'mark' 完整两条评论线;'dot' 微尺寸(≤16px)两线并一点,避免糊成一团。
 *  品牌色取自 tailwind tide ramp(tide-600=#0f7c72),与 wordmark 同色。 */
export function BrandMark({
  size = 28,
  variant = 'mark',
  className,
  title = 'pagepin',
}: {
  size?: number;
  variant?: 'mark' | 'dot';
  className?: string;
  title?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
    >
      <path
        fill="#0f7c72"
        d="M24,2 H76 A22,22 0 0 1 98,24 V76 A22,22 0 0 1 76,98 H24 A22,22 0 0 1 2,76 V24 A22,22 0 0 1 24,2 Z"
      />
      <path fill="#fff" d="M24,52 A26,26 0 1 1 50,78 L27,78 A2,2 0 0 1 25,76 Z" />
      {variant === 'dot' ? (
        <circle cx="49.7" cy="51" r="9" fill="#0f7c72" />
      ) : (
        <>
          <rect x="37" y="42" width="26" height="4.6" rx="2.3" fill="#0f7c72" />
          <rect x="37" y="52" width="17" height="4.6" rx="2.3" fill="#7fcabf" />
        </>
      )}
    </svg>
  );
}
