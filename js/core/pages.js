// Builds one page description per person: the final text of every field after
// per-person overrides, {placeholders}, prefixes / suffixes and text clean-up.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.Cert = root.Cert || {}).pages = factory(root.Cert.text);
})(typeof self !== 'undefined' ? self : this, function (text) {
  'use strict';

  const BUILT_IN_VARS = ['姓名', '序號', '總數'];

  // Placeholder names a user can insert: built-ins plus the roster's own columns.
  function varNames(roster) {
    const columns = roster.people.length ? Object.keys(roster.people[0].vars) : [];
    return [...BUILT_IN_VARS, ...columns.filter((h) => !BUILT_IN_VARS.includes(h))];
  }

  function polish(value, options) {
    let s = value;
    if (options.halfWidth) s = text.toHalfWidthAlnum(s);
    if (options.autoSpace) s = text.autoSpace(s);
    return s;
  }

  // roster: result of table.parseRoster; state: settings state (values,
  // fieldProps, options); fieldDefs: Cert.FIELDS.
  function buildPages(roster, state, fieldDefs) {
    const options = state.options || {};
    const sample = roster.people.length === 0;
    const people = sample ? [{ name: options.sampleName || '王小明', line: -1, overrides: {}, vars: {} }] : roster.people;
    const total = sample ? 0 : people.length;
    const duplicates = text.findDuplicates(people.map((p) => p.name));
    const start = Number.isFinite(options.serialStart) ? options.serialStart : 1;

    return people.map((person, index) => {
      const vars = {
        ...person.vars,
        姓名: person.name,
        序號: text.padNumber(start + index, options.serialPad || 0),
        總數: String(total),
      };
      const fileVars = { ...vars, 人數: String(total) };
      const texts = {};
      const overridden = [];
      const warnings = [];
      if (duplicates.has(person.name)) warnings.push({ type: 'duplicate', text: `姓名「${person.name}」重複` });

      fieldDefs.forEach((def) => {
        const props = (state.fieldProps || {})[def.key] || {};
        let value;
        if (def.fromRoster) {
          value = person.name;
        } else {
          let own = person.overrides[def.key];
          if (own) overridden.push(def.key);
          // A date column from Excel arrives as YYYY-MM-DD; show it in the chosen style.
          if (own && def.isDate && /^\d{4}-\d{2}-\d{2}$/.test(own)) own = text.formatDate(own, options.dateStyle);
          const raw = own || ((state.values || {})[def.key] ?? def.value ?? '');
          text.unknownVars(raw, vars).forEach((key) => {
            warnings.push({ type: 'unknownVar', field: def.key, text: `「${def.label}」的 {${key}} 沒有對應資料` });
          });
          value = text.fillVars(raw, vars);
        }
        value = polish(String(value).trim(), options);
        fileVars[def.label] = value;
        const prefix = props.prefix ?? def.prefix ?? '';
        const suffix = props.suffix ?? '';
        texts[def.key] = props.hidden || !value ? '' : prefix + value + suffix;
      });

      return { index, name: person.name, line: person.line, sample, vars, fileVars, texts, overridden, warnings };
    });
  }

  return { BUILT_IN_VARS, varNames, buildPages };
});
