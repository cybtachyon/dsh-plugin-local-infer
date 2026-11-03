/**
 * The guarded primitive renderers: the card's select, button, checkbox,
 * state dot, throbber, and process button, each drawing the DSH primitives
 * seed when the host provides it and the native control it replaces
 * otherwise.
 *
 * The primitives seed (the shell's @deepseek-ai/dsh-client-ui-primitives) is
 * resolved once by the bootstrap (mountCard) and handed in through
 * setPrimitivesModule. A missing seed is a fallback, not an error: the ref
 * stays null and every renderer draws its native control, so the card renders
 * on a host whose platform table predates the seed.
 * @module dsh-plugin-local-infer/client/render/primitives
 */
import type { ReactNode } from 'react';
import { type SelectItem } from './SelectPill.tsx';
export interface PrimitivesModule {
    Menu?: unknown;
    Button?: unknown;
    Checkbox?: unknown;
    StateDot?: unknown;
    IconChevronDownOutlineRegular?: unknown;
    IconRefreshOutlineRegular?: unknown;
}
/**
 * setPrimitivesModule hands the bootstrap's resolved primitives seed to the
 * renderers. mountCard calls it after its require of the seed, passing null
 * when the seed is absent (the native-control fallback).
 */
export declare function setPrimitivesModule(primitives: PrimitivesModule | null): void;
/** getPrimitivesModule returns the resolved seed, or null for the fallback. */
export declare function getPrimitivesModule(): PrimitivesModule | null;
export type ButtonVariant = 'primary' | 'ghost';
export type StateDotState = 'done' | 'warning' | 'error' | 'ongoing' | 'idle';
export declare function renderHelpRow(text: string | null | undefined): ReactNode;
export declare function renderButton(variant: ButtonVariant | undefined, buttonProps: Record<string, unknown>, children: unknown): ReactNode;
export interface CheckboxProps {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (checked: boolean) => void;
}
export declare function renderCheckbox(checkboxProps: CheckboxProps): ReactNode;
export declare function renderStateDot(state: StateDotState): ReactNode;
export declare function renderThrobber(): ReactNode;
export interface ProcessButtonOpts {
    busy?: boolean;
    label: string;
    busyLabel: string;
    variant?: ButtonVariant;
    onClick?: () => void;
    disabled?: boolean;
}
export declare function renderProcessButton(opts: ProcessButtonOpts): ReactNode;
export interface SelectOpts {
    label: string;
    items: SelectItem[];
    value: string;
    onSelect: (id: string) => void;
    disabled?: boolean;
}
export declare function renderSelect(opts: SelectOpts): ReactNode;
//# sourceMappingURL=primitives.d.ts.map
