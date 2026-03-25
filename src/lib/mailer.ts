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

const FROM =
	process.env.SMTP_FROM ?? `"Profissão Laser" <${process.env.SMTP_USER}>`;

const INTERNAL_BCC = process.env.INTERNAL_BCC_EMAIL;

export async function sendPasswordResetEmail(email: string, resetLink: string) {
	await transporter.sendMail({
		from: FROM,
		to: email,
		bcc: INTERNAL_BCC,
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

export async function sendProvisioningCompleteEmail(params: {
	to: string;
	companyName: string;
	tenantUrl: string;
	adminEmail: string;
	adminPassword: string;
	plan: string;
}) {
	const { to, companyName, tenantUrl, adminEmail, adminPassword, plan } =
		params;

	const systemUrl = tenantUrl.startsWith('http')
		? tenantUrl
		: `https://${tenantUrl}`;

	const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();

	await transporter.sendMail({
		from: FROM,
		to,
		bcc: INTERNAL_BCC,
		subject: '🎉 Seu sistema Laser One está pronto!',
		html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#0d0d0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0d0f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:16px 16px 0 0;padding:40px 40px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.7);">Profissão Laser</p>
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;line-height:1.3;">Seu sistema está pronto! 🎉</h1>
              <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.8);">Tudo configurado para <strong>${companyName}</strong></p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#111113;padding:36px 40px;">

              <!-- Intro -->
              <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.7;">
                Olá! Sua compra foi confirmada e seu sistema personalizado já está no ar.
                Confira abaixo tudo que você precisa para começar:
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a1d;border:1px solid rgba(255,255,255,0.08);border-radius:12px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px 8px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7c3aed;">Acesso ao Sistema</p>
                  </td>
                </tr>

                <!-- URL -->
                <tr>
                  <td style="padding:8px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">
                          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;">🌐 URL do Sistema</p>
                          <a href="${systemUrl}" style="color:#818cf8;font-size:14px;font-family:monospace;text-decoration:none;">${systemUrl}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Email -->
                <tr>
                  <td style="padding:8px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">
                          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;">📧 E-mail do Admin</p>
                          <p style="margin:0;color:#e5e7eb;font-size:14px;font-family:monospace;">${adminEmail}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Password -->
                <tr>
                  <td style="padding:8px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">
                          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;">🔑 Senha do Admin</p>
                          <p style="margin:0;color:#e5e7eb;font-size:14px;font-family:monospace;">${adminPassword}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Plan -->
                <tr>
                  <td style="padding:8px 24px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">
                          <p style="margin:0 0 4px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;">🏆 Plano Contratado</p>
                          <p style="margin:0;color:#a78bfa;font-size:14px;font-weight:600;">${planLabel}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${systemUrl}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:12px;">
                      Acessar meu sistema →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Course info box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d1a0d;border:1px solid rgba(34,197,94,0.15);border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#22c55e;">📚 Acesso ao Curso Profissão Laser</p>
                    <p style="margin:0 0 8px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;">📧 E-mail de acesso</p>
                    <p style="margin:0 0 16px;color:#e5e7eb;font-size:14px;font-family:monospace;">${to}</p>
                    <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.7;">
                      Para acessar o conteúdo do curso <strong style="color:#e5e7eb;">Profissão Laser</strong>,
                      acesse o seu sistema pelo link acima, vá até a aba
                      <strong style="color:#e5e7eb;">Profissão Laser</strong> e faça login com o e-mail acima.
                      <strong style="color:#e5e7eb;">A senha é a mesma para o seu sistema e para a Profissão Laser.</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Help text -->
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;text-align:center;">
                Precisa de ajuda? Entre em contato com nosso suporte.<br/>
                <strong style="color:#9ca3af;">Equipe Profissão Laser</strong>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#0a0a0c;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.04);">
              <p style="margin:0;font-size:12px;color:#4b5563;">
                © ${new Date().getFullYear()} Profissão Laser · Todos os direitos reservados
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
	});
}
