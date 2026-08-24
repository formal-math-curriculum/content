import { generate, loadInputs, validateSource, sha256 } from './generate-m5-6.mjs';
import { validateManifest } from './validate.mjs';

const { source, authority, validationFixture } = await loadInputs();
const errors = validateSource(source, authority, validationFixture);
const generated = await generate({ check: true });
if (!generated.ok) errors.push(...generated.errors);
if (generated.outputs) errors.push(...validateManifest(generated.outputs['content-manifest.json']));

if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else {
  console.log([
    'validated P5-M5.6-CONTENT-v1',
    'entities=' + source.content.length,
    'course_references=' + source.course.references.length,
    'formal_bindings=' + source.formal_bindings.length,
    'source_sha256=' + sha256(source),
    'selector_sha256=' + source.freeze.selector_sha256,
    'dependency_sha256=' + source.generated_dependency.expected_sha256
  ].join(' '));
}
