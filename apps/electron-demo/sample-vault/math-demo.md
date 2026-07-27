# Math Rendering

Back to [[index]].

This note demonstrates the existing `@floatboat/nexus-plugin-math` integration
in the Electron demo.

## Inline formulas

Euler's identity is $e^{i\pi} + 1 = 0$, and the mass-energy relation is
$E = mc^2$. Click an inline formula to reveal its Markdown source.

## Block formulas

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

Hover a block formula to reveal its edit button. The same button must become
visible when reached with the keyboard, and activating it returns the cursor
to the formula source.

## Invalid input

KaTeX errors stay inside the preview instead of breaking the editor:

$\unknownCommand{$
