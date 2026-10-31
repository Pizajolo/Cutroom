const childProcess = new Set(['child_process', 'node:child_process']);
const shellMethods = new Set(['exec', 'execSync']);
const propertyName = (node) => node.computed ? node.property.value : node.property.name;
const isRequire = (node) => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && childProcess.has(node.arguments[0]?.value);

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid shell execution; spawn processes with an argument array.' },
    schema: [],
    messages: { shell: 'shell: true is forbidden. Pass an argument array without a shell.', exec: 'child_process.exec/execSync are forbidden. Use spawn/execFile with an argument array.' },
  },
  create(context) {
    const namespaces = new Set();
    return {
      ImportDeclaration(node) {
        if (!childProcess.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            if (shellMethods.has(specifier.imported.name ?? specifier.imported.value)) context.report({ node: specifier, messageId: 'exec' });
          } else namespaces.add(specifier.local.name);
        }
      },
      VariableDeclarator(node) {
        if (!isRequire(node.init) && !(node.init?.type === 'Identifier' && namespaces.has(node.init.name))) return;
        if (node.id.type === 'Identifier') namespaces.add(node.id.name);
        if (node.id.type === 'ObjectPattern') for (const property of node.id.properties) {
          if (property.type === 'Property' && shellMethods.has(property.key.name ?? property.key.value)) context.report({ node: property, messageId: 'exec' });
        }
      },
      MemberExpression(node) {
        if (!shellMethods.has(propertyName(node))) return;
        if ((node.object.type === 'Identifier' && namespaces.has(node.object.name)) || isRequire(node.object)) context.report({ node, messageId: 'exec' });
      },
      Property(node) {
        const key = node.computed ? node.key.value : node.key.name ?? node.key.value;
        if (key === 'shell' && node.value.type === 'Literal' && node.value.value === true) context.report({ node, messageId: 'shell' });
      },
    };
  },
};
