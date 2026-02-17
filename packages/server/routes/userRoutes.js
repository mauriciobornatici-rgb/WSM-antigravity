import express from 'express';
import * as userController from '../controllers/userController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';

const router = express.Router();

// All routes here are already protected by authenticateToken + authorizeRoles('admin') in index.js
router.get('/', userController.getUsers);
router.post('/', validate(schemas.user), userController.createUser);
router.put('/:id', validate(schemas.userUpdate), userController.updateUser);
router.delete('/:id', validate(schemas.idParam), userController.deleteUser);

export default router;
