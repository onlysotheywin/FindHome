const { z } = require("zod");

const specialties = ["Правоведение", "Логистика", "Экономика", "Программирование"];
const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(8).max(72).regex(/[A-Za-zА-Яа-я]/, "Пароль должен содержать буквы").regex(/[0-9]/, "Пароль должен содержать цифру")
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(1).max(72)
}).strict();

const participantSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  groupName: z.string().trim().min(1).max(30),
  specialty: z.enum(specialties),
  userId: z.number().int().positive().nullable().optional()
}).strict();

const resultSchema = z.object({
  participantId: z.number().int().positive(),
  points: z.number().finite().min(0).max(10000),
  comment: z.string().trim().max(1000).optional().default("")
}).strict();

const stageSchema = z.object({
  title: z.string().trim().min(2).max(100),
  stageDate: z.string().date(),
  maxPoints: z.number().int().min(1).max(10000).optional().default(100)
}).strict();

const competitionSchema = z.object({
  specialty: z.enum(specialties),
  title: z.string().trim().min(2).max(150),
  startDate: z.string().date(),
  endDate: z.string().date()
}).strict().refine(v => v.endDate >= v.startDate, {
  message: "Дата окончания не может быть раньше даты начала",
  path: ["endDate"]
});

const passCountSchema = z.object({
  passCount: z.number().int().min(1).max(10000)
}).strict();

module.exports = { specialties, registerSchema, loginSchema, participantSchema, resultSchema, stageSchema, competitionSchema, passCountSchema };
