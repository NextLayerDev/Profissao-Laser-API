import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST,
	port: Number(process.env.SMTP_PORT),
	secure: process.env.SMTP_SECURE === 'true',
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
});

export async function sendPasswordResetEmail(email: string, resetLink: string) {
	await transporter.sendMail({
		from: `"Profissão Laser" <${process.env.SMTP_USER}>`,
		to: email,
		subject: 'Recuperação de senha',
		html: `
      <p>Olá,</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
      <p>Clique no link abaixo para criar uma nova senha:</p>
      <p><a href="${resetLink}">Redefinir senha</a></p>
      <p>Se você não solicitou a recuperação de senha, ignore este email.</p>
      <p>Atenciosamente,<br/>Equipe Profissão Laser</p>
    `,
	});
}
