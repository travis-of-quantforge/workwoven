import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: "bg-teal-800 text-white hover:bg-teal-900",
        outline:
          "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={twMerge(clsx(variants({ variant }), className))}
      {...props}
    />
  );
}
