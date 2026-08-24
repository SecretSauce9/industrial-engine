// Minimal React 19 type declarations.
// The sandbox that produced this project cannot reach the npm registry, so
// @types/react is unavailable; these hand-written declarations cover the API
// surface this app uses. Replace with @types/react when registry access exists.

declare module "react" {
  export type Key = string | number;
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>;

  export interface ReactElement {
    type: unknown;
    props: unknown;
    key: Key | null;
  }

  export type FC<P = Record<string, never>> = (props: P) => ReactElement | null;

  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);

  export function useState<S>(
    initial: S | (() => S)
  ): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [
    S | undefined,
    Dispatch<SetStateAction<S | undefined>>,
  ];

  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[]
  ): void;

  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

  export function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps: readonly unknown[]
  ): T;

  export interface MutableRefObject<T> {
    current: T;
  }
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): MutableRefObject<T | null>;

  export function useId(): string;

  export const StrictMode: FC<{ children?: ReactNode }>;
  export const Fragment: unique symbol;

  export interface SyntheticEvent<T = Element> {
    currentTarget: T;
    target: EventTarget & T;
    preventDefault(): void;
    stopPropagation(): void;
  }
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {}
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface MouseEvent<T = Element> extends SyntheticEvent<T> {
    clientX: number;
    clientY: number;
  }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }
  export interface DragEvent<T = Element> extends SyntheticEvent<T> {
    dataTransfer: {
      setData(format: string, data: string): void;
      getData(format: string): string;
      dropEffect: string;
      effectAllowed: string;
    };
  }

  const React: {
    useState: typeof useState;
    useEffect: typeof useEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useRef: typeof useRef;
    StrictMode: typeof StrictMode;
  };
  export default React;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module "react/jsx-runtime" {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}

declare module "react/jsx-dev-runtime" {
  export const jsxDEV: unknown;
  export const Fragment: unknown;
}

declare namespace JSX {
  type Booleanish = boolean | "true" | "false";

  interface DomProps {
    children?: import("react").ReactNode;
    key?: string | number | null;
    ref?: unknown;
    className?: string;
    id?: string;
    style?: Partial<CSSStyleDeclaration> | Record<string, string | number>;
    title?: string;
    role?: string;
    tabIndex?: number;
    hidden?: boolean;
    lang?: string;
    dir?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-hidden"?: Booleanish;
    "aria-live"?: "off" | "polite" | "assertive";
    "aria-pressed"?: Booleanish;
    "aria-expanded"?: Booleanish;
    "aria-selected"?: Booleanish;
    "aria-disabled"?: Booleanish;
    "aria-current"?: string;
    "aria-modal"?: Booleanish;
    "aria-valuemin"?: number;
    "aria-valuemax"?: number;
    "aria-valuenow"?: number;
    "aria-valuetext"?: string;
    "data-testid"?: string;
    onClick?: (e: import("react").MouseEvent<HTMLElement>) => void;
    onChange?: (e: import("react").ChangeEvent<HTMLElement>) => void;
    onInput?: (e: import("react").ChangeEvent<HTMLElement>) => void;
    onSubmit?: (e: import("react").FormEvent<HTMLElement>) => void;
    onKeyDown?: (e: import("react").KeyboardEvent<HTMLElement>) => void;
    onFocus?: (e: import("react").SyntheticEvent<HTMLElement>) => void;
    onBlur?: (e: import("react").SyntheticEvent<HTMLElement>) => void;
    draggable?: boolean;
    onDragStart?: (e: import("react").DragEvent<HTMLElement>) => void;
    onDragOver?: (e: import("react").DragEvent<HTMLElement>) => void;
    onDrop?: (e: import("react").DragEvent<HTMLElement>) => void;
    onDragEnd?: (e: import("react").DragEvent<HTMLElement>) => void;
    [attr: `data-${string}`]: string | number | boolean | undefined;
  }

  interface ButtonProps extends DomProps {
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    autoFocus?: boolean;
  }

  interface InputProps extends DomProps {
    type?: string;
    value?: string | number;
    defaultValue?: string | number;
    checked?: boolean;
    defaultChecked?: boolean;
    placeholder?: string;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    name?: string;
    disabled?: boolean;
    readOnly?: boolean;
    autoFocus?: boolean;
    onChange?: (e: import("react").ChangeEvent<HTMLInputElement>) => void;
  }

  interface SelectProps extends DomProps {
    value?: string | number;
    defaultValue?: string | number;
    name?: string;
    disabled?: boolean;
    onChange?: (e: import("react").ChangeEvent<HTMLSelectElement>) => void;
  }

  interface OptionProps extends DomProps {
    value?: string | number;
    disabled?: boolean;
  }

  interface LabelProps extends DomProps {
    htmlFor?: string;
  }

  interface FormProps extends DomProps {
    onSubmit?: (e: import("react").FormEvent<HTMLFormElement>) => void;
  }

  interface AnchorProps extends DomProps {
    href?: string;
    target?: string;
    rel?: string;
    download?: string;
  }

  interface TextareaProps extends DomProps {
    value?: string;
    defaultValue?: string;
    rows?: number;
    cols?: number;
    placeholder?: string;
    readOnly?: boolean;
    disabled?: boolean;
    onChange?: (e: import("react").ChangeEvent<HTMLTextAreaElement>) => void;
  }

  interface DialogProps extends DomProps {
    open?: boolean;
  }

  interface SvgProps {
    children?: import("react").ReactNode;
    key?: string | number | null;
    className?: string;
    viewBox?: string;
    width?: number | string;
    height?: number | string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number | string;
    strokeLinecap?: string;
    strokeLinejoin?: string;
    d?: string;
    cx?: number | string;
    cy?: number | string;
    r?: number | string;
    x?: number | string;
    y?: number | string;
    x1?: number | string;
    y1?: number | string;
    x2?: number | string;
    y2?: number | string;
    rx?: number | string;
    ry?: number | string;
    points?: string;
    transform?: string;
    opacity?: number | string;
    "aria-hidden"?: Booleanish;
    role?: string;
    focusable?: string;
    style?: Record<string, string | number>;
  }

  interface IntrinsicElements {
    a: AnchorProps;
    abbr: DomProps;
    article: DomProps;
    aside: DomProps;
    b: DomProps;
    br: DomProps;
    button: ButtonProps;
    caption: DomProps;
    code: DomProps;
    dd: DomProps;
    details: DomProps;
    dialog: DialogProps;
    div: DomProps;
    dl: DomProps;
    dt: DomProps;
    em: DomProps;
    fieldset: DomProps;
    footer: DomProps;
    form: FormProps;
    h1: DomProps;
    h2: DomProps;
    h3: DomProps;
    h4: DomProps;
    h5: DomProps;
    header: DomProps;
    hr: DomProps;
    i: DomProps;
    input: InputProps;
    kbd: DomProps;
    label: LabelProps;
    legend: DomProps;
    li: DomProps;
    main: DomProps;
    nav: DomProps;
    ol: DomProps;
    optgroup: DomProps & { label?: string };
    option: OptionProps;
    p: DomProps;
    pre: DomProps;
    section: DomProps;
    select: SelectProps;
    small: DomProps;
    span: DomProps;
    strong: DomProps;
    summary: DomProps;
    sup: DomProps;
    table: DomProps;
    tbody: DomProps;
    td: DomProps & { colSpan?: number; rowSpan?: number };
    textarea: TextareaProps;
    tfoot: DomProps;
    th: DomProps & { colSpan?: number; scope?: string };
    thead: DomProps;
    tr: DomProps;
    ul: DomProps;
    svg: SvgProps & { xmlns?: string };
    path: SvgProps;
    circle: SvgProps;
    rect: SvgProps;
    line: SvgProps;
    polygon: SvgProps;
    polyline: SvgProps;
    g: SvgProps;
    ellipse: SvgProps;
    text: SvgProps & { fontSize?: number | string; textAnchor?: string };
  }

  interface ElementChildrenAttribute {
    children: unknown;
  }

  interface IntrinsicAttributes {
    key?: string | number | null;
  }

  type Element = import("react").ReactElement;
}
