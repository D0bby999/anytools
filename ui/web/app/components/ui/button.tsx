import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

/**
 * The button of byoungd/up's quick-start (styles.css `.quick-start-action`):
 * 14px at 650, a 6px corner from `radius-control`, colour changes over
 * 160ms, and a focus outline set 3px off the edge.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-[650] leading-[1.4] " +
    "transition-[background-color,border-color,color] duration-[160ms] " +
    "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary " +
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // One action ink. `outline` is the secondary action (a hairline that
      // turns to the action ink on hover), `ghost` the quiet one; red is for
      // destroying something and nothing else.
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:bg-primary-active",
        outline: "border-border bg-transparent text-foreground hover:border-primary hover:text-primary",
        ghost: "border-transparent text-primary hover:text-primary-hover",
        destructive: "border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 px-3 py-0 font-semibold",
        lg: "min-h-12 px-6 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
