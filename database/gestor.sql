-- ============================================
-- CREAR BASE DE DATOS
-- ============================================
CREATE DATABASE IF NOT EXISTS `call_center_support`;
USE `call_center_support`;

-- ============================================
-- CONFIGURACIÓN INICIAL
-- ============================================
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- ============================================
-- TABLA: users
-- ============================================
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `full_name` varchar(100) NOT NULL,
  `role` enum('admin','supervisor','coordinador','jefe_operaciones','technician','administrativo','anonimo','gestorActivos') NOT NULL DEFAULT 'technician',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `sede` enum('bogota','barranquilla','villavicencio') DEFAULT 'bogota',
  `departamento` enum('claro','majority','obama') DEFAULT 'claro',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `users` VALUES 
(1,'davidlopez10','$2b$10$1qBnwCUEyhlff8mlYCFzieBBfvrl2uUxDpo5.CbgShGdmlmzFvNay','David (Administrador)','admin','2025-08-25 15:08:26','2026-01-26 17:39:33','bogota','claro'),
(2,'kevin','$2b$10$EvkG1eePlZwneJ8QUMvQn.d/9lkx68zpu2X.4KtiStd7tWZ8aA9sG','Kevin (Supervisor)','supervisor','2025-08-25 15:08:26','2025-08-25 15:49:03','bogota','claro'),
(3,'tecnico1','$2b$10$fd.JvDJGqRE4hCGnvERUm.z6hD7v67S/ChD4GincoiIT0Pfjb7yLW','Juan Perez (Técnico)','technician','2025-08-25 15:08:26','2025-08-25 15:49:03','bogota','claro'),
(4,'tecnico2','$2b$10$0U./sQbJkpvwEn6i28wwyOoPCTMDxdAG8uxUfMdja/rqL8Vu.Bj/y','Ana Lopez (Técnica)','technician','2025-08-25 15:08:26','2025-08-25 15:49:03','bogota','claro'),
(9,'Ramirez','$2b$10$kNZ18aHC4eBIoy5vclSpIuRG0woo8Cdxwgyh2xKLQHK9k/LIG9hWe','Carlos','coordinador','2025-08-26 02:09:12','2025-08-26 02:09:12','villavicencio','claro'),
(10,'coordinador_villa','$2b$10$1gimddaEu71.0kN0ICe5iu80y3.UqxK4cxor7k5wKTeXy49wxt9/6','Coordinador Villavicencio','coordinador','2025-08-26 02:12:54','2025-08-26 02:12:54','villavicencio','claro'),
(11,'coord_barranquilla','$2b$10$ANpDH3/WVLFvH.xcHsYo4.oA/0hAnZi8.HDsKZzcRv2pQnhZcjGEG','Coordinador Barranquilla','coordinador','2025-08-26 13:59:37','2025-08-26 13:59:37','barranquilla','claro'),
(12,'tecnico_vvc','$2b$10$AQcVvdZ8QarhBBiaknOqdOCXYnd/KQKkEe/FWBHomRMb7qgdGiEbe','Carlos Martinez (Técnico VVC)','technician','2025-08-26 15:07:49','2025-08-26 15:07:49','villavicencio','claro'),
(13,'jefe_claro_bogota','$2b$10$MAaQB/lNG0vsAexmIQK5TOWWwJnArycpzswltMJgUy1m..Hs0J/1i','María González (Jefe Claro Bogotá)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','bogota','claro'),
(14,'jefe_obama_bogota','$2b$10$i2oiIvYgkuNWYMQEUnIy5.ke8FUkrGc5EaeiKVVR6//S2zX0ORWqW','Carlos Rodríguez (Jefe Obama Bogotá)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','bogota','obama'),
(15,'jefe_majority_bogota','$2b$10$5zEMUxY5T5bmeKAdZSee0OGCR3.l8Wi.FkNfiViZPg8eraHfMdPES','Ana Martínez (Jefe Majority Bogotá)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','bogota','majority'),
(16,'jefe_claro_barranquilla','$2b$10$rL6zUbJWrnerRC4Mb4HF3ukWyATy5EtPX2GLhFzqCfpTq55tQdMYC','Luis Herrera (Jefe Claro Barranquilla)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','barranquilla','claro'),
(17,'jefe_obama_barranquilla','$2b$10$oJk25K/T6zHhj/rr33hBtOZHv4oAFNNxA9oSKsM.zW9pm0Ot9OftK','Patricia Silva (Jefe Obama Barranquilla)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','barranquilla','obama'),
(18,'jefe_claro_villavicencio','$2b$10$D9TNQbOUj0KWSulp0PVq8.Owgj3D7q8M2ruAhua7reilWj2yUC6Zm','Roberto Castro (Jefe Claro Villavicencio)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','villavicencio','claro'),
(19,'jefe_obama_villavicencio','$2b$10$18.LtIlfVlPH68djds79.e1X0ykV2qD45Sj4xSDR7DXD09zbujYS6','Sandra Moreno (Jefe Obama Villavicencio)','jefe_operaciones','2025-08-26 15:56:31','2025-08-26 15:56:31','villavicencio','obama'),
(20,'hannycita10','$2b$10$SeA4mNk.XYazWkzI..cbcOdNdE6Hk9gmI401DC9qXZFQ14oclIc9q','Hanny Admin','admin','2025-08-26 21:49:52','2025-08-26 21:49:52','bogota',NULL),
(21,'coordinador1','$2b$10$5nDj3K6Ru8fAMeG3Dq2KcOp2yKcdheR94.pjeryCYf8awKsHeisD2','Maria Gonzalez','coordinador','2025-08-29 20:24:29','2025-08-29 20:27:28','bogota','obama'),
(22,'usuarioactivosprueba','$2b$10$fVEgR5VoF0OVQgpe55lpceGAccb5UjkpNLmMRBbir4xLl3CtrsL22','usuarioactivosprueba','gestorActivos','2025-12-14 22:07:47','2025-12-14 22:07:47','bogota','claro');

-- ============================================
-- TABLA: workstations
-- ============================================
DROP TABLE IF EXISTS `workstations`;
CREATE TABLE `workstations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `station_code` varchar(20) NOT NULL,
  `location_details` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `sede` enum('bogota','barranquilla','villavicencio') DEFAULT 'bogota',
  `departamento` enum('claro','majority','obama') DEFAULT 'claro',
  `anydesk_address` varchar(255) DEFAULT NULL,
  `advisor_cedula` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `station_code` (`station_code`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `workstations` VALUES 
(1,'A1','Fila A, Puesto 1','2025-08-25 15:08:26','bogota','obama',NULL,NULL),
(2,'A2','Fila A, Puesto 2','2025-08-25 15:08:26','bogota','claro',NULL,NULL),
(3,'B8','Fila B, Puesto 8, cerca de la ventana','2025-08-25 15:08:26','bogota','claro',NULL,NULL),
(4,'O080','Puesto O080 - OBAMA','2025-08-26 00:39:18','bogota','obama',NULL,NULL),
(5,'C200','Puesto C200 - CLARO','2025-08-26 00:40:45','bogota','claro',NULL,NULL),
(6,'V001','Puesto V001 - Villavicencio','2025-08-26 02:38:54','villavicencio','claro',NULL,NULL),
(7,'V002','Puesto V002 - Villavicencio','2025-08-26 02:38:54','villavicencio','obama',NULL,NULL),
(8,'V003','Puesto V003 - Villavicencio','2025-08-26 02:38:54','villavicencio','obama',NULL,NULL),
(9,'BAQ-001','Workstation 1 - Remota','2025-08-26 13:59:37','barranquilla','claro','900123456','32456789'),
(10,'BAQ-002','Workstation 2 - Remota','2025-08-26 13:59:37','barranquilla','obama','900123457','32456790'),
(11,'BAQ-003','Workstation 3 - Remota','2025-08-26 13:59:37','barranquilla','claro','900123458','32456791'),
(12,'O001','Puesto Obama 1','2025-08-26 14:51:41','bogota','obama',NULL,NULL),
(13,'C002','Puesto Claro 2','2025-08-26 14:51:41','bogota','claro',NULL,NULL),
(14,'M003','Puesto Majority 3','2025-08-26 14:51:41','bogota','majority',NULL,NULL),
(15,'VVC-O001','Puesto Obama Villavicencio 1','2025-08-26 14:51:41','villavicencio','obama',NULL,NULL),
(16,'VVC-C002','Puesto Claro Villavicencio 2','2025-08-26 14:51:41','villavicencio','claro',NULL,NULL),
(17,'BAQ-O001','Puesto Obama Barranquilla 1 (Remoto)','2025-08-26 14:51:41','barranquilla','obama','900123456','32456789'),
(18,'BAQ-C002','Puesto Claro Barranquilla 2 (Remoto)','2025-08-26 14:51:41','barranquilla','claro','900222222','30222222'),
(19,'BAQ-C015','Puesto BAQ-C015 - CLARO (Remoto)','2025-08-26 16:08:01','barranquilla','claro','123-456-789','98765432'),
(20,'O069','Puesto O069 - OBAMA','2025-08-29 16:03:00','bogota','obama',NULL,NULL),
(21,'B-OBA-001','Puesto B-OBA-001 - OBAMA (Remoto)','2025-08-29 19:50:35','barranquilla','obama','900123458','32456791'),
(22,'B-OBA-200','Puesto B-OBA-200 - OBAMA','2025-08-29 20:28:21','bogota','obama',NULL,NULL);

-- ============================================
-- TABLA: incidents
-- ============================================
DROP TABLE IF EXISTS `incidents`;
CREATE TABLE `incidents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workstation_id` int NOT NULL,
  `reported_by_id` int NOT NULL,
  `assigned_to_id` int DEFAULT NULL,
  `failure_type` enum('pantalla','perifericos','internet','software','otro') NOT NULL,
  `description` text NOT NULL,
  `status` enum('pendiente','en_proceso','en_supervision','rechazado','aprobado') NOT NULL DEFAULT 'pendiente',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workstation_id` (`workstation_id`),
  KEY `reported_by_id` (`reported_by_id`),
  KEY `assigned_to_id` (`assigned_to_id`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `incidents` VALUES 
(1,1,2,3,'perifericos','[Diadema] La diadema tiene una falla en el microfono, este no funciona correctamente.','aprobado','2025-08-25 15:56:50','2025-08-25 16:31:33'),
(2,3,2,3,'pantalla','La pantalla no da imagen','en_proceso','2025-08-25 17:11:56','2025-08-25 17:13:04'),
(3,1,2,NULL,'internet','El internet falla, posiblemente el cable ethernet.','pendiente','2025-08-25 17:38:26','2025-08-25 17:38:26'),
(4,1,2,NULL,'software','Poliedro no funciona en este pc, se queda cargando.','pendiente','2025-08-25 17:51:13','2025-08-25 17:51:13'),
(5,2,2,NULL,'pantalla','Esta es una falla de prueba.','pendiente','2025-08-25 17:55:09','2025-08-25 17:55:09'),
(6,1,2,NULL,'otro','Esta es otra incidencia de prueba.','pendiente','2025-08-25 17:58:29','2025-08-25 17:58:29'),
(7,1,2,NULL,'otro','Otra incidencia de prueba.','pendiente','2025-08-25 18:02:29','2025-08-25 18:02:29'),
(8,1,2,NULL,'otro','Otra incidencia de prueba 2','pendiente','2025-08-25 18:05:16','2025-08-25 18:05:16'),
(9,1,2,NULL,'pantalla','otro 3','pendiente','2025-08-25 18:08:11','2025-08-25 18:08:11'),
(10,2,2,NULL,'otro','otro 4','pendiente','2025-08-25 18:11:17','2025-08-25 18:11:17'),
(11,3,2,3,'otro','Otro 5','en_proceso','2025-08-25 18:13:42','2025-08-25 18:15:15'),
(12,4,2,3,'pantalla','La pantalla presenta una fraja roja en la mitad.','en_proceso','2025-08-26 00:39:18','2025-08-26 00:44:43'),
(13,5,2,3,'internet','No tiene conexion a internet.','aprobado','2025-08-26 00:40:45','2025-08-26 00:43:02'),
(14,6,10,NULL,'pantalla','Pantalla no enciende en Villavicencio','pendiente','2025-08-26 02:38:54','2025-08-26 02:38:54'),
(15,7,10,NULL,'internet','Sin conectividad en estación Obama Villavicencio','en_proceso','2025-08-26 02:38:54','2025-08-26 02:38:54'),
(16,8,10,NULL,'perifericos','Teclado no funciona - Majority Villavicencio','aprobado','2025-08-26 02:38:54','2025-08-26 02:38:54'),
(17,12,1,NULL,'pantalla','Pantalla parpadea en Bogotá Obama','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(18,13,1,NULL,'internet','Internet lento en Bogotá Claro','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(19,14,2,NULL,'software','Software se cierra en Bogotá Majority','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(20,15,1,NULL,'perifericos','Mouse no funciona en Villavicencio Obama','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(21,16,1,NULL,'pantalla','Monitor sin imagen en Villavicencio Claro','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(22,17,11,NULL,'internet','Conexión remota inestable en Barranquilla Obama','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(23,18,11,NULL,'software','AnyDesk no conecta en Barranquilla Claro','pendiente','2025-08-26 14:51:41','2025-08-26 14:51:41'),
(24,19,11,NULL,'software','Problema con sistema de facturación','pendiente','2025-08-26 16:08:01','2025-08-26 16:08:01'),
(25,20,2,3,'perifericos','[Diadema] E','aprobado','2025-08-29 16:03:01','2025-08-29 16:05:07'),
(26,17,11,NULL,'perifericos','[Diadema] Prueba','pendiente','2025-08-29 18:02:23','2025-08-29 18:02:23'),
(27,21,11,NULL,'pantalla','Prueba adjunto','pendiente','2025-08-29 19:50:35','2025-08-29 19:50:35'),
(28,22,21,3,'pantalla','Prueba estrella 2','aprobado','2025-08-29 20:28:21','2025-08-29 20:30:05');

-- ============================================
-- TABLA: incident_history
-- ============================================
DROP TABLE IF EXISTS `incident_history`;
CREATE TABLE `incident_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(255) NOT NULL,
  `details` text,
  `timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `incident_id` (`incident_id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `incident_history` VALUES 
(1,1,2,'Creación','Incidencia creada por el supervisor','2025-08-25 15:56:50'),
(2,1,3,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-25 16:18:05'),
(3,1,3,'Marcado como resuelto','Técnico reporta solución: Tuvo que cambiarse la diadema.','2025-08-25 16:18:43'),
(4,1,2,'Rechazado por supervisor','Motivo del rechazo: La diadema nueva no funciona.','2025-08-25 16:19:20'),
(5,1,3,'Marcado como resuelto','Técnico reporta solución: Se volvio a cambiar la diadema a una nueva distinta.','2025-08-25 16:26:52'),
(6,1,2,'Aprobado por supervisor','Incidencia aprobada: Esta diadema funciona perfecto, agradezco la gestion.','2025-08-25 16:31:33'),
(7,2,2,'Creación','Incidencia creada por el supervisor','2025-08-25 17:11:56'),
(8,2,1,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-25 17:13:04'),
(9,3,2,'Creación','Incidencia creada por el supervisor','2025-08-25 17:38:26'),
(10,4,2,'Creación','Incidencia creada por el supervisor','2025-08-25 17:51:13'),
(11,5,2,'Creación','Incidencia creada por el supervisor','2025-08-25 17:55:09'),
(12,6,2,'Creación','Incidencia creada por el supervisor','2025-08-25 17:58:29'),
(13,7,2,'Creación','Incidencia creada por el supervisor','2025-08-25 18:02:29'),
(14,8,2,'Creación','Incidencia creada por el supervisor','2025-08-25 18:05:16'),
(15,9,2,'Creación','Incidencia creada por el supervisor','2025-08-25 18:08:11'),
(16,10,2,'Creación','Incidencia creada por el supervisor','2025-08-25 18:11:17'),
(17,11,2,'Creación','Incidencia creada por el supervisor','2025-08-25 18:13:42'),
(18,11,1,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-25 18:15:15'),
(19,12,2,'Creación','Incidencia creada por el supervisor','2025-08-26 00:39:18'),
(20,13,2,'Creación','Incidencia creada por el supervisor','2025-08-26 00:40:45'),
(21,13,3,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-26 00:42:07'),
(22,13,3,'Marcado como resuelto','Técnico reporta solución: Se cambio el cable ethernet','2025-08-26 00:42:36'),
(23,13,2,'Aprobado por supervisor','Incidencia aprobada: Excelente, gracias.','2025-08-26 00:43:02'),
(24,12,1,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-26 00:44:43'),
(25,24,11,'Creación','Incidencia creada por el supervisor','2025-08-26 16:08:01'),
(26,25,2,'Creación','Incidencia creada por el supervisor','2025-08-29 16:03:01'),
(27,25,3,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-29 16:03:44'),
(28,25,3,'Marcado como resuelto','Técnico reporta solución: r','2025-08-29 16:03:56'),
(29,25,2,'Rechazado por supervisor','Motivo del rechazo: l','2025-08-29 16:04:32'),
(30,25,3,'Marcado como resuelto','Técnico reporta solución: jh','2025-08-29 16:04:58'),
(31,25,2,'Aprobado por supervisor','Incidencia aprobada: g','2025-08-29 16:05:07'),
(32,26,11,'Creación','Incidencia creada por el supervisor','2025-08-29 18:02:23'),
(33,27,11,'Creación','Incidencia creada por el supervisor','2025-08-29 19:50:35'),
(34,28,21,'Creación','Incidencia creada por el supervisor','2025-08-29 20:28:21'),
(35,28,3,'Asignación de técnico','Asignado a: Juan Perez (Técnico)','2025-08-29 20:28:50'),
(36,28,3,'Marcado como resuelto','Técnico reporta solución: Resuelto estrella 2','2025-08-29 20:29:07'),
(37,28,21,'Aprobado por supervisor','Incidencia aprobada: Super','2025-08-29 20:30:05');

-- ============================================
-- TABLA: incident_attachments
-- ============================================
DROP TABLE IF EXISTS `incident_attachments`;
CREATE TABLE `incident_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `filename` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `file_type` varchar(100) NOT NULL,
  `file_size` int NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_by` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `incident_id` (`incident_id`),
  KEY `uploaded_by` (`uploaded_by`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `incident_attachments` VALUES 
(1,27,'1756497035089_872367236_imagen.png','imagen.png','image/png',172051,'uploads/incidents/1756497035089_872367236_imagen.png','2025-08-29 19:50:35',11),
(2,28,'1756499301059_442263166_DIAPOSITIVAS AISITE ING 11-2-3.pdf','DIAPOSITIVAS AISITE ING 11-2-3.pdf','application/pdf',767873,'uploads/incidents/1756499301059_442263166_DIAPOSITIVAS AISITE ING 11-2-3.pdf','2025-08-29 20:28:21',21);

-- ============================================
-- TABLA: chat_conversations
-- ============================================
DROP TABLE IF EXISTS `chat_conversations`;
CREATE TABLE `chat_conversations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `anonymous_user_id` int NOT NULL,
  `admin_user_id` int NOT NULL,
  `status` enum('active','closed') DEFAULT 'active',
  `last_message_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_conversation` (`anonymous_user_id`,`admin_user_id`),
  KEY `idx_admin_conversations` (`admin_user_id`,`status`),
  KEY `idx_last_message` (`last_message_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `chat_conversations` VALUES (1,27,26,'active','2025-09-18 16:12:23','2025-09-18 15:59:21');

-- ============================================
-- TABLA: private_chat_messages
-- ============================================
DROP TABLE IF EXISTS `private_chat_messages`;
CREATE TABLE `private_chat_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_user_id` int NOT NULL,
  `to_user_id` int NOT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversation` (`from_user_id`,`to_user_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_unread` (`to_user_id`,`is_read`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `private_chat_messages` VALUES 
(1,27,26,'Holaaa',1,'2025-09-18 15:59:21','2025-09-18 16:11:32'),
(2,27,26,'AAA',1,'2025-09-18 16:08:23','2025-09-18 16:11:32'),
(3,27,26,'aaa',1,'2025-09-18 16:09:30','2025-09-18 16:11:32'),
(4,26,27,'Hola, que tal?',1,'2025-09-18 16:11:42','2025-09-18 16:11:46'),
(5,27,26,'aasdfasd',1,'2025-09-18 16:12:23','2025-09-18 16:12:35');

-- ============================================
-- TABLA: supervision_alerts
-- ============================================
DROP TABLE IF EXISTS `supervision_alerts`;
CREATE TABLE `supervision_alerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sent_by_id` int NOT NULL,
  `sent_to_id` int NOT NULL,
  `message` text NOT NULL,
  `incident_ids` json DEFAULT NULL,
  `status` enum('sent','read','dismissed') DEFAULT 'sent',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sent_by_id` (`sent_by_id`),
  KEY `idx_sent_to_status` (`sent_to_id`,`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `supervision_alerts` VALUES 
(1,1,25,'mmmm19100982\n\nIncidencias pendientes: BOG-C020 (259h)','[31]','read','2025-09-18 15:15:52','2025-09-18 15:16:04'),
(2,1,25,'9098898778\n\nIncidencias pendientes: BOG-C020 (259h)','[31]','read','2025-09-18 15:19:32','2025-09-18 15:20:45'),
(3,1,25,'yaaa\n\nIncidencias pendientes: BOG-C020 (259h)','[31]','read','2025-09-18 15:22:25','2025-09-18 15:22:46'),
(4,1,25,'alkklllll\n\nIncidencias pendientes: BOG-C020 (259h)','[31]','read','2025-09-18 15:23:58','2025-09-18 15:28:55'),
(5,1,25,'aaaa\n\nIncidencias pendientes: BOG-C020 (260h)','[31]','read','2025-09-18 15:39:52','2025-09-18 15:40:02');

-- ============================================
-- TABLA: technician_ratings
-- ============================================
DROP TABLE IF EXISTS `technician_ratings`;
CREATE TABLE `technician_ratings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `technician_id` int NOT NULL,
  `rated_by_id` int NOT NULL,
  `rating` int NOT NULL,
  `feedback` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_incident_rating` (`incident_id`),
  KEY `idx_technician_ratings` (`technician_id`),
  KEY `idx_rated_by` (`rated_by_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `technician_ratings` VALUES (1,28,3,21,4,'Super','2025-08-29 20:30:05','2025-08-29 20:30:05');

-- ============================================
-- TABLA: activos
-- ============================================
DROP TABLE IF EXISTS `activos`;
CREATE TABLE `activos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `numero_placa` varchar(100) NOT NULL,
  `centro_costes` int NOT NULL,
  `ubicacion` enum('Claro','Obama','IT','Contratación','Reclutamiento','Selección','Finanzas','Majority') NOT NULL,
  `empresa` varchar(50) NOT NULL DEFAULT 'Asiste',
  `responsable` varchar(100) NOT NULL,
  `proveedor` varchar(200) DEFAULT NULL,
  `valor` decimal(15,2) DEFAULT NULL,
  `fecha_compra` date DEFAULT NULL,
  `numero_social` varchar(100) DEFAULT NULL,
  `poliza` varchar(100) DEFAULT NULL,
  `aseguradora` varchar(200) DEFAULT NULL,
  `garantia` enum('Si','No') NOT NULL DEFAULT 'No',
  `fecha_vencimiento_garantia` date DEFAULT NULL,
  `orden_compra` varchar(100) DEFAULT NULL,
  `clasificacion` enum('Activo productivo','Activo no productivo') NOT NULL,
  `clasificacion_activo_fijo` varchar(200) DEFAULT NULL,
  `adjunto_archivo` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by_id` int DEFAULT NULL,
  `marca_modelo` varchar(200) DEFAULT NULL,
  `numero_serie_fabricante` varchar(200) DEFAULT NULL,
  `cpu_procesador` varchar(300) DEFAULT NULL,
  `memoria_ram` varchar(200) DEFAULT NULL,
  `almacenamiento` varchar(200) DEFAULT NULL,
  `sistema_operativo` varchar(200) DEFAULT NULL,
  `pulgadas` varchar(50) DEFAULT NULL,
  `estado` enum('funcional','en_reparacion','dado_de_baja','en_mantenimiento','disponible','asignado','fuera_de_servicio') NOT NULL DEFAULT 'funcional',
  `tipo_activo` enum('ECC-CPU','ECC-SER','ECC-MON','ECC-IMP','ECC-POR','ECC-TV','OTHER') DEFAULT NULL,
  `site` enum('Site A','Site B') DEFAULT NULL,
  `asignado` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `created_by_id` (`created_by_id`),
  KEY `idx_activos_tipo_activo` (`tipo_activo`),
  KEY `idx_activos_estado` (`estado`),
  KEY `idx_activos_marca_modelo` (`marca_modelo`),
  KEY `idx_activos_numero_serie` (`numero_serie_fabricante`),
  KEY `idx_activos_site` (`site`),
  KEY `idx_activos_asignado` (`asignado`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `activos` VALUES 
(1,'123',1,'Claro','Asiste','David López',NULL,NULL,'2025-10-10','24787832',NULL,NULL,'No',NULL,'87237878','Activo productivo','Esta es una descripción de prueba','1760912653760_206565702_En caso de incendio.pdf','2025-10-19 22:24:13','2025-12-14 22:27:02',33,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'funcional','OTHER',NULL,NULL),
(2,'328787',1,'Claro','Asiste','David López','asdcasd',20000000.00,'2018-10-20','23342134','23423','aasdsd','No',NULL,'234234','Activo productivo','23423423',NULL,'2025-12-14 22:08:52','2025-12-14 22:27:02',22,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'funcional','OTHER',NULL,NULL),
(10,'ECC-CPU-001',1,'Claro','Asiste','David Lopez','Julio SAS',650000.00,'2018-10-20','49883','ASD','ASD','No',NULL,'32788723','Activo productivo','ASDCSD',NULL,'2025-12-15 01:46:33','2025-12-15 01:46:33',22,'Lenovo','23878723','Intel i5','16GB','SSD 512','Windows 11',NULL,'funcional','ECC-CPU','Site A',NULL);

-- ============================================
-- RESTAURAR CONFIGURACIÓN FINAL
-- ============================================
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

-- Script completado exitosamente