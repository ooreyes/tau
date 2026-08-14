//! Expand LTspice `.step` cards that stock ngspice rejects as unimplemented.
//!
//! Tau still *emits* `.step` in native-step decks (one invoke from the UI).
//! Before `ngSpice_Circ`, this module strips those cards and drives one run
//! per swept member so multi-plot families match the TypeScript re-run path
//! without double-stepping.

use std::collections::BTreeMap;

const MAX_STEP_POINTS: usize = 100_001;
const MAX_FAMILY_MEMBERS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    Temp,
    Source,
    Param,
}

#[derive(Debug, Clone)]
pub struct StepAxis {
    pub kind: StepKind,
    pub name: Option<String>,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct StepMember {
    pub temp: Option<f64>,
    pub sources: BTreeMap<String, f64>,
    pub params: BTreeMap<String, f64>,
}

/// Split a screened deck into (lines without `.step`, parsed axes). Empty axes
/// means an ordinary single-run deck.
pub fn split_step_directives(lines: &[String]) -> Result<(Vec<String>, Vec<StepAxis>), String> {
    let mut base = Vec::with_capacity(lines.len());
    let mut axes = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            base.push(line.clone());
            continue;
        }
        let bare = trimmed.trim_start_matches(['.', '!']);
        if bare.len() == trimmed.len() {
            // Not a dot card.
            base.push(line.clone());
            continue;
        }
        if !bare.to_ascii_lowercase().starts_with("step") {
            base.push(line.clone());
            continue;
        }
        let axis = parse_step_directive(trimmed).ok_or_else(|| {
            format!(
                "Unsupported or empty .step on line {}: {trimmed}",
                index + 1
            )
        })?;
        axes.push(axis);
    }
    Ok((base, axes))
}

/** A `.step` axis name, restricted to a SPICE designator.
 *
 * This is not defensive politeness, and the reason is the same one
 * `live_spice::alter_command` already documents: the name is spliced into
 * `alter <name>=<value>` and handed to `ngSpice_Command`, which is the *whole*
 * ngspice command interpreter — `source`, `shell`, `destroy` and `write` are all
 * reachable through it, and its text is split on whitespace and newlines with
 * backquote and `$` expansion applied. The live channel validates for exactly
 * this; the batch `.step` path grew later and did not, so a `.asc` that arrives
 * by email could put separators or a backquote in a source name and reach the
 * interpreter. `screen_card`'s deck allowlist cannot catch it, because these
 * `alter` strings are COMMANDS and never pass through the deck at all.
 *
 * The grammar matches `validate_instance` so the two channels agree, minus `$`:
 * a stepped designator has no business naming an interpreter variable, and
 * leaving it out costs nothing real.
 *
 * Returning `None` is a hard refusal naming the line — `split_step_directives`
 * turns it into an error — so a rejected card fails loudly instead of silently
 * collapsing a swept family into a single run.
 */
fn valid_step_source_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '#' | '-' | '+')
        })
}

/// A `.step param` name is a plain identifier: it is substituted into `.param`
/// deck text rather than an interpreter command, but it is kept narrow for the
/// same reason - one grammar per field, no separators.
fn valid_step_param_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

pub fn parse_step_directive(line: &str) -> Option<StepAxis> {
    let cleaned = line.trim().trim_start_matches(['.', '!']).trim();
    let tokens: Vec<&str> = cleaned
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() || !tokens[0].eq_ignore_ascii_case("step") {
        return None;
    }
    let mut i = 1usize;
    let mut scale = "lin";
    if i < tokens.len() {
        let head = tokens[i].to_ascii_lowercase();
        if matches!(head.as_str(), "lin" | "dec" | "oct") {
            scale = tokens[i];
            i += 1;
        }
    }
    if i >= tokens.len() {
        return None;
    }
    let head = tokens[i].to_ascii_lowercase();
    let (kind, name) = if head == "param" {
        i += 1;
        if i >= tokens.len() {
            return None;
        }
        let n = tokens[i].to_string();
        if !valid_step_param_name(&n) {
            return None;
        }
        i += 1;
        (StepKind::Param, Some(n))
    } else if head == "temp" {
        i += 1;
        (StepKind::Temp, None)
    } else {
        let n = tokens[i].to_string();
        // The source name reaches the ngspice command interpreter verbatim.
        if !valid_step_source_name(&n) {
            return None;
        }
        i += 1;
        (StepKind::Source, Some(n))
    };
    let rest = &tokens[i..];
    if rest.is_empty() {
        return None;
    }
    let values = if rest[0].eq_ignore_ascii_case("list") {
        rest[1..]
            .iter()
            .filter_map(|t| parse_spice_float(t))
            .collect::<Vec<_>>()
    } else if rest.len() >= 3 {
        let start = parse_spice_float(rest[0])?;
        let stop = parse_spice_float(rest[1])?;
        let third = parse_spice_float(rest[2])?;
        let scale_l = scale.to_ascii_lowercase();
        if scale_l == "dec" {
            log_values(start, stop, third, 10.0)
        } else if scale_l == "oct" {
            log_values(start, stop, third, 2.0)
        } else {
            linear_values(start, stop, third)
        }
    } else {
        return None;
    };
    if values.is_empty() {
        return None;
    }
    Some(StepAxis { kind, name, values })
}

pub fn step_members(axes: &[StepAxis]) -> Result<Vec<StepMember>, String> {
    if axes.is_empty() {
        return Ok(Vec::new());
    }
    let mut product: usize = 1;
    for axis in axes {
        product = product
            .checked_mul(axis.values.len())
            .ok_or_else(|| "`.step` product overflowed.".to_string())?;
    }
    if product > MAX_FAMILY_MEMBERS {
        return Err(format!(
            ".step asks for {product} members; Tau's native limit is {MAX_FAMILY_MEMBERS}."
        ));
    }
    let mut members = vec![StepMember::default()];
    for axis in axes {
        let mut next = Vec::with_capacity(members.len() * axis.values.len());
        for prefix in &members {
            for &value in &axis.values {
                let mut m = prefix.clone();
                match axis.kind {
                    StepKind::Temp => m.temp = Some(value),
                    StepKind::Source => {
                        if let Some(name) = &axis.name {
                            m.sources.insert(name.to_ascii_lowercase(), value);
                        }
                    }
                    StepKind::Param => {
                        if let Some(name) = &axis.name {
                            m.params.insert(name.to_ascii_lowercase(), value);
                        }
                    }
                }
                next.push(m);
            }
        }
        members = next;
    }
    Ok(members)
}

/// Rewrite `.temp` / `.param` for one member. Source alters are applied after
/// `circ` via {@link source_alter_commands}.
pub fn apply_member_to_deck(base_lines: &[String], member: &StepMember) -> Vec<String> {
    let mut out: Vec<String> = base_lines
        .iter()
        .filter(|line| {
            let bare = line.trim().trim_start_matches(['.', '!']);
            !bare.to_ascii_lowercase().starts_with("temp")
        })
        .cloned()
        .collect();

    // Update existing `.param` / `.params` bindings; collect names still missing.
    let mut missing: Vec<(String, f64)> =
        member.params.iter().map(|(k, v)| (k.clone(), *v)).collect();
    for line in &mut out {
        let trimmed = line.trim();
        let bare = trimmed.trim_start_matches(['.', '!']);
        let lower = bare.to_ascii_lowercase();
        if !(lower.starts_with("param ")
            || lower.starts_with("params ")
            || lower == "param"
            || lower == "params")
        {
            continue;
        }
        let mut rewritten = rewrite_param_line(trimmed, &member.params);
        missing.retain(|(name, _)| !param_line_has_binding(&rewritten, name));
        // Preserve leading whitespace style by replacing the whole trimmed card.
        if let Some(pos) = line.find(trimmed) {
            let mut next = String::new();
            next.push_str(&line[..pos]);
            // Prefer a single `.param` spelling.
            if rewritten.starts_with('.') || rewritten.starts_with('!') {
                // ok
            } else {
                rewritten = format!(".{rewritten}");
            }
            // Normalize bang to dot.
            if rewritten.starts_with('!') {
                rewritten = format!(".{}", &rewritten[1..]);
            }
            next.push_str(&rewritten);
            next.push_str(&line[pos + trimmed.len()..]);
            *line = next;
        } else {
            *line = rewritten;
        }
    }
    // Insert missing param bindings and optional `.temp` just before the first
    // analysis / `.end` card so ordering stays SPICE-legal.
    let insert_at = out
        .iter()
        .position(|line| {
            let bare = line
                .trim()
                .trim_start_matches(['.', '!'])
                .to_ascii_lowercase();
            bare.starts_with("tran")
                || bare.starts_with("ac")
                || bare.starts_with("dc")
                || bare.starts_with("op")
                || bare.starts_with("noise")
                || bare.starts_with("tf")
                || bare.starts_with("meas")
                || bare.starts_with("four")
                || bare == "end"
        })
        .unwrap_or(out.len().saturating_sub(1));

    let mut injected = Vec::new();
    if let Some(temp) = member.temp {
        injected.push(format!(".temp {temp}"));
    }
    if !missing.is_empty() {
        let body = missing
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join(" ");
        injected.push(format!(".param {body}"));
    }
    for (offset, card) in injected.into_iter().enumerate() {
        out.insert(insert_at + offset, card);
    }
    out
}

pub fn source_alter_commands(member: &StepMember) -> Vec<String> {
    member
        .sources
        .iter()
        .map(|(name, value)| format!("alter {name}={value}"))
        .collect()
}

fn rewrite_param_line(line: &str, params: &BTreeMap<String, f64>) -> String {
    let trimmed = line.trim();
    let bang = trimmed.starts_with('!');
    let bare = trimmed.trim_start_matches(['.', '!']);
    let mut parts = bare.split_whitespace();
    let keyword = parts.next().unwrap_or("param");
    let rest = parts.collect::<Vec<_>>().join(" ");
    if rest.is_empty() {
        return trimmed.to_string();
    }
    let mut bindings = Vec::new();
    for token in rest.split_whitespace() {
        if let Some((name, _)) = token.split_once('=') {
            let key = name.to_ascii_lowercase();
            if let Some(value) = params.get(&key) {
                bindings.push(format!("{name}={value}"));
                continue;
            }
        }
        bindings.push(token.to_string());
    }
    let body = bindings.join(" ");
    if bang {
        format!("!{keyword} {body}")
    } else {
        format!(".{keyword} {body}")
    }
}

fn param_line_has_binding(line: &str, name: &str) -> bool {
    let bare = line.trim().trim_start_matches(['.', '!']);
    for token in bare.split_whitespace().skip(1) {
        if let Some((n, _)) = token.split_once('=') {
            if n.eq_ignore_ascii_case(name) {
                return true;
            }
        }
    }
    false
}

fn linear_values(start: f64, stop: f64, increment: f64) -> Vec<f64> {
    if increment == 0.0 {
        return Vec::new();
    }
    let dir = if stop >= start { 1.0 } else { -1.0 };
    let inc = increment.abs() * dir;
    let count = ((stop - start) / inc + 1e-9).floor() as i64 + 1;
    if count <= 0 || count as usize > MAX_STEP_POINTS {
        return Vec::new();
    }
    (0..count).map(|k| start + (k as f64) * inc).collect()
}

fn log_values(start: f64, stop: f64, points_per: f64, base: f64) -> Vec<f64> {
    if start <= 0.0 || stop <= start || points_per <= 0.0 {
        return Vec::new();
    }
    let ratio = base.powf(1.0 / points_per);
    let mut out = Vec::new();
    let mut v = start;
    while v <= stop * (1.0 + 1e-9) {
        out.push(v);
        v *= ratio;
        if out.len() > MAX_STEP_POINTS {
            return Vec::new();
        }
    }
    out
}

/// Minimal SI-suffix float parser for `.step` tokens (`1k`, `27`, `1e-3`).
pub fn parse_spice_float(token: &str) -> Option<f64> {
    let t = token.trim().replace(['µ', 'μ'], "u");
    if t.is_empty() {
        return None;
    }
    // Pure float / scientific.
    if let Ok(v) = t.parse::<f64>() {
        return Some(v);
    }
    let bytes = t.as_bytes();
    let mut i = 0usize;
    if bytes[0] == b'+' || bytes[0] == b'-' {
        i = 1;
    }
    let start = i;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
        i += 1;
    }
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        i += 1;
        if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
            i += 1;
        }
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i == start {
        return None;
    }
    let number: f64 = t[..i].parse().ok()?;
    let suffix = t[i..].to_ascii_lowercase();
    let mult = match suffix.as_str() {
        "" | "v" | "a" | "hz" => 1.0,
        "t" => 1e12,
        "g" => 1e9,
        "meg" => 1e6,
        "k" => 1e3,
        "mil" => 25.4e-6,
        "m" => 1e-3,
        "u" | "μ" => 1e-6,
        "n" => 1e-9,
        "p" => 1e-12,
        "f" => 1e-15,
        _ => {
            // LTspice ignores trailing unit letters after a known scale; reject unknown.
            if suffix.chars().all(|c| c.is_ascii_alphabetic()) && suffix.len() <= 4 {
                // e.g. "Hz" already handled; bare unknown → None
                return None;
            }
            return None;
        }
    };
    Some(number * mult)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_temp_linear_and_list() {
        let lin = parse_step_directive(".step temp 0 50 25").unwrap();
        assert_eq!(lin.kind, StepKind::Temp);
        assert_eq!(lin.values, vec![0.0, 25.0, 50.0]);
        let list = parse_step_directive(".step temp list -40 27 125").unwrap();
        assert_eq!(list.values, vec![-40.0, 27.0, 125.0]);
    }

    #[test]
    fn parses_param_and_source() {
        let p = parse_step_directive(".step param Rload list 1k 2k").unwrap();
        assert_eq!(p.kind, StepKind::Param);
        assert_eq!(p.name.as_deref(), Some("Rload"));
        assert_eq!(p.values, vec![1000.0, 2000.0]);
        let s = parse_step_directive(".step V1 1 3 1").unwrap();
        assert_eq!(s.kind, StepKind::Source);
        assert_eq!(s.name.as_deref(), Some("V1"));
        assert_eq!(s.values, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn splits_and_applies_temp() {
        let lines = vec![
            "Tau".into(),
            "V1 in 0 1".into(),
            "R1 in out 1k tc1=0.01".into(),
            "R2 out 0 1k".into(),
            ".temp 27".into(),
            ".tran 1u 1m".into(),
            ".step temp 27 77 50".into(),
            ".end".into(),
        ];
        let (base, axes) = split_step_directives(&lines).unwrap();
        assert_eq!(axes.len(), 1);
        assert!(!base.iter().any(|l| l.contains(".step")));
        let members = step_members(&axes).unwrap();
        assert_eq!(members.len(), 2);
        let deck0 = apply_member_to_deck(&base, &members[0]);
        assert!(deck0.iter().any(|l| l == ".temp 27"));
        assert!(!deck0.iter().any(|l| l.contains(".step")));
        let deck1 = apply_member_to_deck(&base, &members[1]);
        assert!(deck1.iter().any(|l| l == ".temp 77"));
    }

    #[test]
    fn applies_param_binding() {
        let lines = vec![
            "Tau".into(),
            ".param Rload=1000".into(),
            "R1 in out {Rload}".into(),
            ".op".into(),
            ".end".into(),
        ];
        let member = StepMember {
            params: BTreeMap::from([("rload".into(), 3000.0)]),
            ..Default::default()
        };
        let deck = apply_member_to_deck(&lines, &member);
        assert!(deck
            .iter()
            .any(|l| l.contains("Rload=3000") || l.contains("rload=3000")));
    }

    /// A `.step` source name is spliced into `alter <name>=<value>` and handed to
    /// `ngSpice_Command`, the whole ngspice interpreter. Before this validation a
    /// crafted `.asc` could put a backquote or a separator in that name and reach
    /// it - `screen_card`'s deck allowlist cannot see a COMMAND.
    #[test]
    fn refuses_step_names_that_would_reach_the_ngspice_interpreter() {
        for hostile in [
            ".step v1`id` 1 2 1",
            ".step v1;shell 1 2 1",
            ".step v1|tee 1 2 1",
            ".step $v1 1 2 1",
            ".step v1&whoami 1 2 1",
            ".step param p`id` 1 2 1",
            ".step param p;x 1 2 1",
        ] {
            assert!(
                parse_step_directive(hostile).is_none(),
                "accepted a hostile .step name: {hostile}"
            );
            assert!(
                split_step_directives(&[hostile.to_string()]).is_err(),
                "hostile .step did not fail the deck: {hostile}"
            );
        }
    }

    /// The grammar has to stay wide enough for real designators, or the fix
    /// breaks ordinary decks instead of hostile ones.
    #[test]
    fn still_accepts_ordinary_designators_and_param_names() {
        for good in [
            ".step v1 1 2 1",
            ".step Vin 0 5 1",
            ".step I2 1 2 1",
            ".step x1.v1 1 2 1",
            ".step param Rload 1 2 1",
            ".step param temp_co 1 2 1",
            ".step temp 0 50 25",
        ] {
            assert!(parse_step_directive(good).is_some(), "rejected a real .step: {good}");
        }
    }

    /// The exact shape that reaches the interpreter, so a future refactor cannot
    /// quietly reintroduce an unvalidated splice.
    #[test]
    fn source_alter_commands_are_free_of_interpreter_metacharacters() {
        let axis = parse_step_directive(".step v1 1 3 1").expect("a real .step parses");
        let members = step_members(&[axis]).expect("members expand");
        for member in &members {
            for command in source_alter_commands(member) {
                assert!(
                    crate::spice::reject_interpreter_metacharacters(&command).is_ok(),
                    "generated command would be refused at the sink: {command}"
                );
            }
        }
    }

}
