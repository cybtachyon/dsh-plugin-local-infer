// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Local rule: a `description` string that opens is-style ("is the KV data
 * type", "It is ...", "This is ...") describes what a thing is, not what it
 * does. The ParameterSpec descriptions the plan requires are behavior-first,
 * so the rule reports them and names the fix.
 */
const localInfer = {
    rules: {
        'behavior-first-description': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'description strings must be behavior-first, not is-style',
                },
                messages: {
                    isStyle:
                        '"{{text}}" is an is-style description. Describe what the parameter does, not what it is.',
                },
                schema: [],
            },
            create(context) {
                return {
                    Property(node) {
                        const key = node.key;
                        const keyName =
                            key.type === 'Identifier'
                                ? key.name
                                : key.type === 'Literal'
                                  ? String(key.value)
                                  : null;
                        if (keyName !== 'description') {
                            return;
                        }
                        const value = node.value;
                        if (value.type !== 'Literal' || typeof value.value !== 'string') {
                            return;
                        }
                        // is-style openers: the copula leads, so the sentence
                        // names a thing instead of an effect.
                        if (/^\s*(is|it is|this is|are|was|were)\s/i.test(value.value)) {
                            context.report({
                                node: value,
                                messageId: 'isStyle',
                                data: { text: value.value },
                            });
                        }
                    },
                };
            },
        },
    },
};

export default defineConfig({
    files: ['**/*.{js,ts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'local-infer': localInfer },
    rules: {
        // Stub parameters in the scaffold are intentionally unused; the leading
        // underscore marks a placeholder a later phase fills in.
        '@typescript-eslint/no-unused-vars': [
            'error',
            { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'local-infer/behavior-first-description': 'error',
    },
});
