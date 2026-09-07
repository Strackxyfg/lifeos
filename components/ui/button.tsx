import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
    "transition-[transform,background,box-shadow,border-color,color] duration-200 ease-premium " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-foreground text-background hover:bg-foreground/90 shadow-subtle",
        accent:
          "bg-accent text-accent-foreground hover:brightness-110 hover:shadow-glow",
        secondary:
          "bg-surface-2 text-foreground border border-border hover:border-border-strong hover:bg-surface-2/70",
        ghost: "text-muted-foreground hover:text-foreground hover:bg-surface-2",
        link: "text-foreground underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3 text-[0.8125rem] rounded-md",
        md: "h-10 px-4 text-sm rounded-lg",
        lg: "h-12 px-6 text-[0.9375rem] rounded-lg",
        icon: "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
