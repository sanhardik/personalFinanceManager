## What does this PR do?

<!-- Describe the change. Link to the issue it closes if applicable. -->
<!-- e.g. "Adds a CSV parser for Commonwealth Bank accounts. Closes #42" -->



## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New bank / institution parser
- [ ] Documentation update
- [ ] Refactor (no behaviour change)
- [ ] Test improvement
- [ ] CI / tooling change

---

## Checklist

- [ ] I've read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] All existing tests pass (`./run.sh test`)
- [ ] I've added tests for my change

**If this adds a new bank parser:**
- [ ] Parser implements the `BankParser` ABC
- [ ] Parser is registered in `registry.py`
- [ ] Test fixture CSV uses fully synthetic (anonymised) data
- [ ] At least 10 test cases covering: header detection, expense rows, income rows, date parsing, balance field, deduplication, and account type detection
- [ ] Supported banks table updated in `README.md`
- [ ] Any known edge cases or quirks documented in code comments

---

## Screenshots / output (if applicable)

<!-- Paste a screenshot or test output if it helps illustrate the change -->
