// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@solidjs/testing-library';
import type { FlowProps } from 'solid-js';
import {
    FormStatusContext,
    type FormStatusContextValue,
    useFormStatus,
} from '../utils/hooks/form-status';

describe('useFormStatus', () => {
    it('returns inert defaults when used outside a <Form>', () => {
        const { result } = renderHook(useFormStatus);
        expect(result.pending()).toBe(false);
        expect(result.data()).toBeNull();
        expect(result.method()).toBe('GET');
        expect(result.action()).toBeNull();
    });

    it('returns the provided context value when nested in a provider', () => {
        const value: FormStatusContextValue = {
            pending: () => true,
            data: () => null,
            method: () => 'POST',
            action: () => '/submit',
        };
        const wrapper = (props: FlowProps) => (
            <FormStatusContext.Provider value={value}>
                {props.children}
            </FormStatusContext.Provider>
        );
        const { result } = renderHook(useFormStatus, { wrapper });
        expect(result.pending()).toBe(true);
        expect(result.method()).toBe('POST');
        expect(result.action()).toBe('/submit');
    });
});
