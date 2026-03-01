import type { FastifyInstance } from 'fastify';
import { authRoute } from './routes/auth.js';
import { classRoute } from './routes/class.js';
import { couponRoute } from './routes/coupon.js';
import { courseRoute } from './routes/course.js';
import { customerRoute } from './routes/customer.js';
import { lessonRoute } from './routes/lesson.js';
import { moduleRoute } from './routes/module.js';
import { productRoute } from './routes/product.js';
import { purchaseRoute } from './routes/purchase.js';
import { quizRoute } from './routes/quiz.js';
import { userRoute } from './routes/user.js';

export const routes = async (app: FastifyInstance) => {
	app.register(authRoute);
	app.register(classRoute);
	app.register(couponRoute);
	app.register(courseRoute);
	app.register(customerRoute);
	app.register(lessonRoute);
	app.register(moduleRoute);
	app.register(productRoute);
	app.register(purchaseRoute);
	app.register(quizRoute);
	app.register(userRoute);
};
