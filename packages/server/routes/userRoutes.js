import express from 'express';
import * as userController from '../controllers/userController.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validationMiddleware.js';

const router = express.Router();

// All routes here are already protected by authenticateToken + authorizeRoles('admin') in index.js
router.get('/', userController.getUsers);
router.post('/', validateZod(zodSchemas.user), userController.createUser);
router.put('/:id', validateZod(zodSchemas.userUpdate), userController.updateUser);
router.delete('/:id', validate(schemas.idParam), userController.deleteUser);

export default router;
