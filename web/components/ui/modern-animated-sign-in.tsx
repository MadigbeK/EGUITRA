"use client";
import {
  memo,
  ReactNode,
  useState,
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  forwardRef,
} from "react";
import {
  motion,
  useAnimation,
  useInView,
  useMotionTemplate,
  useMotionValue,
} from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modern Animated Sign-In — composants Ripple + Orbit + BoxReveal + AnimatedForm.
 * Adapté palette EGUITRA GROUP : halo input ORANGE CAPSULE au lieu de bleu.
 * Utilisé sur /login (et /first-login si besoin).
 */

/* ────────────────── Input avec halo orange capsule au hover ──────────────────
   Variation du pattern Aceternity. Halo radial qui suit la souris,
   coloré en orange capsule EGUITRA GROUP oklch(72% 0.180 55).
   ──────────────────────────────────────────────────────────────────────────── */
export const Input = memo(
  forwardRef(function InputInner(
    { className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>,
    ref: React.ForwardedRef<HTMLInputElement>,
  ) {
    const radius = 120;
    const [visible, setVisible] = useState(false);

    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    function handleMouseMove({
      currentTarget,
      clientX,
      clientY,
    }: React.MouseEvent<HTMLDivElement>) {
      const { left, top } = currentTarget.getBoundingClientRect();
      mouseX.set(clientX - left);
      mouseY.set(clientY - top);
    }

    return (
      <motion.div
        style={{
          background: useMotionTemplate`
            radial-gradient(
              ${visible ? radius + "px" : "0px"} circle at ${mouseX}px ${mouseY}px,
              oklch(72% 0.180 55),
              transparent 80%
            )
          `,
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="group/input rounded-lg p-[2px] transition duration-300"
      >
        <input
          type={type}
          className={cn(
            // Base : input dark theme EGUITRA GROUP
            "shadow-input flex h-11 w-full rounded-md border-none px-3 py-2 text-sm transition duration-400",
            "bg-panel text-ink placeholder:text-ink-4",
            "group-hover/input:shadow-none",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          ref={ref}
          {...props}
        />
      </motion.div>
    );
  }),
);
Input.displayName = "Input";

/* ────────────────── BoxReveal : reveal slide animation ────────────────── */
type BoxRevealProps = {
  children: ReactNode;
  width?: string;
  boxColor?: string;
  duration?: number;
  overflow?: string;
  position?: string;
  className?: string;
};

export const BoxReveal = memo(function BoxReveal({
  children,
  width = "fit-content",
  boxColor,
  duration,
  overflow = "hidden",
  position = "relative",
  className,
}: BoxRevealProps) {
  const mainControls = useAnimation();
  const slideControls = useAnimation();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (isInView) {
      slideControls.start("visible");
      mainControls.start("visible");
    } else {
      slideControls.start("hidden");
      mainControls.start("hidden");
    }
  }, [isInView, mainControls, slideControls]);

  return (
    <section
      ref={ref}
      style={{
        position: position as
          | "relative"
          | "absolute"
          | "fixed"
          | "sticky"
          | "static",
        width,
        overflow,
      }}
      className={className}
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 75 },
          visible: { opacity: 1, y: 0 },
        }}
        initial="hidden"
        animate={mainControls}
        transition={{ duration: duration ?? 0.5, delay: 0.25 }}
      >
        {children}
      </motion.div>
      <motion.div
        variants={{ hidden: { left: 0 }, visible: { left: "100%" } }}
        initial="hidden"
        animate={slideControls}
        transition={{ duration: duration ?? 0.5, ease: "easeIn" }}
        style={{
          position: "absolute",
          top: 4,
          bottom: 4,
          left: 0,
          right: 0,
          zIndex: 20,
          background: boxColor ?? "var(--skeleton)",
          borderRadius: 4,
        }}
      />
    </section>
  );
});

/* ────────────────── Ripple : cercles concentriques ────────────────── */
type RippleProps = {
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  numCircles?: number;
  className?: string;
};

export const Ripple = memo(function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.24,
  numCircles = 11,
  className = "",
}: RippleProps) {
  return (
    <section
      className={`absolute inset-0 flex items-center justify-center max-w-[50%]
        bg-bg-2/40
        [mask-image:linear-gradient(to_bottom,white,transparent)] ${className}`}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 70;
        const opacity = mainCircleOpacity - i * 0.03;
        const animationDelay = `${i * 0.06}s`;
        const borderStyle = i === numCircles - 1 ? "dashed" : "solid";
        const borderOpacity = 5 + i * 5;

        return (
          <span
            key={i}
            className="absolute animate-ripple rounded-full border"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity,
              animationDelay,
              borderStyle,
              borderWidth: "1px",
              borderColor: `oklch(72% 0.180 55 / ${borderOpacity / 100})`,
              background: `oklch(72% 0.180 55 / ${Math.max(0.02, opacity * 0.1)})`,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </section>
  );
});

/* ────────────────── OrbitingCircles ────────────────── */
type OrbitingCirclesProps = {
  className?: string;
  children: ReactNode;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
};

export const OrbitingCircles = memo(function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  delay = 10,
  radius = 50,
  path = true,
}: OrbitingCirclesProps) {
  return (
    <>
      {path && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <circle
            className="stroke-line/40 stroke-1"
            cx="50%"
            cy="50%"
            r={radius}
            fill="none"
          />
        </svg>
      )}
      <section
        style={
          {
            "--duration": duration,
            "--radius": radius,
            "--delay": -delay,
          } as React.CSSProperties
        }
        className={cn(
          "absolute flex size-full transform-gpu animate-orbit items-center justify-center rounded-full border border-line/30 bg-bg-2/20 [animation-delay:calc(var(--delay)*1000ms)]",
          { "[animation-direction:reverse]": reverse },
          className,
        )}
      >
        {children}
      </section>
    </>
  );
});

/* ────────────────── TechOrbitDisplay : title gradient + orbites ────────────────── */
type IconConfig = {
  className?: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
  component: () => React.ReactNode;
};

type TechnologyOrbitDisplayProps = {
  iconsArray: IconConfig[];
  /** Texte central en gradient (fallback si pas de centerSlot) */
  text?: string;
  /** Slot React custom au centre — remplace le text. Utilisé pour un logo image. */
  centerSlot?: ReactNode;
};

export const TechOrbitDisplay = memo(function TechOrbitDisplay({
  iconsArray,
  text = "EGUITRA Finance",
  centerSlot,
}: TechnologyOrbitDisplayProps) {
  return (
    <section className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-lg">
      {centerSlot ? (
        <div className="pointer-events-none relative z-10 flex items-center justify-center">
          {centerSlot}
        </div>
      ) : (
        <span className="pointer-events-none whitespace-pre-wrap bg-gradient-to-b from-ink to-brand-green-vif/30 bg-clip-text text-center font-display text-7xl font-bold leading-none tracking-tight text-transparent">
          {text}
        </span>
      )}

      {iconsArray.map((icon, index) => (
        <OrbitingCircles
          key={index}
          className={icon.className}
          duration={icon.duration}
          delay={icon.delay}
          radius={icon.radius}
          path={icon.path}
          reverse={icon.reverse}
        >
          {icon.component()}
        </OrbitingCircles>
      ))}
    </section>
  );
});

/* ────────────────── Label minimaliste interne ────────────────── */
interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  htmlFor?: string;
}

export const Label = memo(function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-sm font-semibold leading-none text-ink-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
});

/* ────────────────── BottomGradient : effet hover boutons ────────────────── */
export const BottomGradient = () => {
  return (
    <>
      <span className="absolute inset-x-0 -bottom-px block h-px w-full bg-gradient-to-r from-transparent via-brand-orange to-transparent opacity-0 transition duration-500 group-hover/btn:opacity-100" />
      <span className="absolute inset-x-10 -bottom-px mx-auto block h-px w-1/2 bg-gradient-to-r from-transparent via-brand-green-vif to-transparent opacity-0 blur-sm transition duration-500 group-hover/btn:opacity-100" />
    </>
  );
};

/* ────────────────── AnimatedForm : form complet avec BoxReveal ────────────────── */
type FieldType = "text" | "email" | "password";

type Field = {
  label: string;
  required?: boolean;
  type: FieldType;
  placeholder?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

type AnimatedFormProps = {
  header: string;
  subHeader?: string;
  fields: Field[];
  submitButton: string;
  textVariantButton?: string;
  errorField?: string;
  fieldPerRow?: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  goTo?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  loading?: boolean;
};

type Errors = {
  [key: string]: string;
};

export const AnimatedForm = memo(function AnimatedForm({
  header,
  subHeader,
  fields,
  submitButton,
  textVariantButton,
  errorField,
  fieldPerRow = 1,
  onSubmit,
  goTo,
  loading = false,
}: AnimatedFormProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});

  const toggleVisibility = () => setVisible(!visible);

  const validateForm = (event: FormEvent<HTMLFormElement>) => {
    const currentErrors: Errors = {};
    fields.forEach((field) => {
      const value = (event.target as HTMLFormElement)[field.label]?.value;
      if (field.required && !value) {
        currentErrors[field.label] = `${field.label} requis`;
      }
      if (field.type === "email" && value && !/\S+@\S+\.\S+/.test(value)) {
        currentErrors[field.label] = "Email invalide";
      }
    });
    return currentErrors;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formErrors = validateForm(event);
    if (Object.keys(formErrors).length === 0) {
      setErrors({});
      onSubmit(event);
    } else {
      setErrors(formErrors);
    }
  };

  return (
    <section className="mx-auto flex w-96 flex-col gap-4 max-md:w-full">
      <BoxReveal boxColor="var(--skeleton)" duration={0.3}>
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink">
          {header}
        </h2>
      </BoxReveal>

      {subHeader && (
        <BoxReveal boxColor="var(--skeleton)" duration={0.3} className="pb-2">
          <p className="max-w-sm text-sm text-ink-3">{subHeader}</p>
        </BoxReveal>
      )}

      <form onSubmit={handleSubmit}>
        <section
          className={cn(
            "mb-4 grid grid-cols-1",
            fieldPerRow === 2 && "md:grid-cols-2",
          )}
        >
          {fields.map((field) => (
            <section key={field.label} className="flex flex-col gap-2">
              <BoxReveal boxColor="var(--skeleton)" duration={0.3}>
                <Label htmlFor={field.label}>
                  {field.label}{" "}
                  {field.required && <span className="text-danger">*</span>}
                </Label>
              </BoxReveal>

              <BoxReveal
                width="100%"
                boxColor="var(--skeleton)"
                duration={0.3}
                className="flex w-full flex-col space-y-2"
              >
                <section className="relative">
                  <Input
                    type={
                      field.type === "password"
                        ? visible
                          ? "text"
                          : "password"
                        : field.type
                    }
                    id={field.label}
                    name={field.label}
                    placeholder={field.placeholder}
                    onChange={field.onChange}
                    autoComplete={
                      field.type === "password"
                        ? "current-password"
                        : field.type === "email"
                          ? "email"
                          : "off"
                    }
                  />

                  {field.type === "password" && (
                    <button
                      type="button"
                      onClick={toggleVisibility}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-sm leading-5 text-ink-3 hover:text-ink"
                      aria-label={visible ? "Masquer mot de passe" : "Afficher mot de passe"}
                    >
                      {visible ? (
                        <Eye className="h-4.5 w-4.5" />
                      ) : (
                        <EyeOff className="h-4.5 w-4.5" />
                      )}
                    </button>
                  )}
                </section>

                <section className="h-4">
                  {errors[field.label] && (
                    <p className="text-xs text-danger">{errors[field.label]}</p>
                  )}
                </section>
              </BoxReveal>
            </section>
          ))}
        </section>

        {errorField && (
          <BoxReveal width="100%" boxColor="var(--skeleton)" duration={0.3}>
            <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorField}
            </p>
          </BoxReveal>
        )}

        <BoxReveal
          width="100%"
          boxColor="var(--skeleton)"
          duration={0.3}
          overflow="visible"
        >
          <button
            className="group/btn relative block h-11 w-full rounded-md bg-gradient-to-br from-brand-orange to-brand-orange-2 font-bold text-brand-navy-deep shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#00000020_inset] outline-hidden hover:cursor-pointer hover:brightness-110 disabled:opacity-50"
            type="submit"
            disabled={loading}
          >
            {loading ? "..." : `${submitButton} →`}
            <BottomGradient />
          </button>
        </BoxReveal>

        {textVariantButton && goTo && (
          <BoxReveal boxColor="var(--skeleton)" duration={0.3}>
            <section className="mt-4 text-center hover:cursor-pointer">
              <button
                className="text-sm text-brand-orange outline-hidden hover:cursor-pointer hover:underline"
                type="button"
                onClick={goTo}
              >
                {textVariantButton}
              </button>
            </section>
          </BoxReveal>
        )}
      </form>
    </section>
  );
});

/* ────────────────── AuthTabs : wrapper du form (right side) ────────────────── */
interface AuthTabsProps {
  formFields: Omit<AnimatedFormProps, "onSubmit" | "goTo">;
  goTo: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export const AuthTabs = memo(function AuthTabs({
  formFields,
  goTo,
  handleSubmit,
}: AuthTabsProps) {
  return (
    <div className="flex w-full items-center justify-center">
      <AnimatedForm
        {...formFields}
        fieldPerRow={1}
        onSubmit={handleSubmit}
        goTo={goTo}
      />
    </div>
  );
});
