---
type: area
---
# Lines the PII filter must drop (synthetic values)
- матрас PESEL 90010112349 — dropped (PESEL-like)
- матрас karta 1234 5678 9012 3456 — dropped (card-like)
- матрас kontakt jan@example.com — dropped (e-mail)
- матрас пароль: qwerty — dropped (secret word)
- матрас paszport AB 1234567 — dropped (passport-like)
- матрас 180x200 clean line — kept
