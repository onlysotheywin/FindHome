const jwt = require("jsonwebtoken");

function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Требуется Bearer-токен авторизации" } });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Токен недействителен или истёк" } });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Недостаточно прав: требуется роль admin" } });
  }
  next();
}

function validate(schema, source = "body") {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте входные данные",
          details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message }))
        }
      });
    }
    req[source] = parsed.data;
    next();
  };
}

module.exports = { authenticate, requireAdmin, validate };
