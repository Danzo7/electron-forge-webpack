/* eslint "arrow-parens": "off", "@typescript-eslint/no-explicit-any": "off" */
export default (fn1, fn2) => {
    let once = true;
    let val;
    const make = (fn) => ((...args) => {
        if (once) {
            val = fn(...args);
            once = false;
        }
        return val;
    });
    return [make(fn1), make(fn2)];
};
//# sourceMappingURL=once.js.map