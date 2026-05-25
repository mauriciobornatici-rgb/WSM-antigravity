import bcrypt from 'bcrypt';
import pool from '../config/db.js';

async function resetPassword() {
    try {
        const email = 'admin@sports.store';
        const newPassword = 'Password123!';
        console.log(`Reseteando contraseña para ${email}...`);
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const [result] = await pool.query(
            'UPDATE users SET password_hash = ? WHERE email = ?',
            [hashedPassword, email]
        );
        
        if (result.affectedRows > 0) {
            console.log('✅ Contraseña actualizada exitosamente a: Password123!');
        } else {
            console.log('❌ Usuario no encontrado.');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        pool.end();
    }
}

resetPassword();
