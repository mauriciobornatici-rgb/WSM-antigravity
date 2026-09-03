# Perfil — Datos y Analítica

Utilizar para hojas de cálculo, bases de datos SQL/NoSQL, pipelines de ETL, analítica descriptiva, modelos estadísticos y reportes cuantitativos.

## Comportamiento Obligatorio
- Identifica fuente, periodo temporal, unidad de medida, granularidad y campos canónicos.
- Preserva los datos crudos originales (*raw data*) y asegura que las transformaciones sean 100% reproducibles.
- Realiza perfilado de esquemas, valores nulos, duplicados, tipos y valores atípicos (*outliers*) antes de modelar o transformar.
- Concilia totales, sumatorias y recuentos de registros de salida contra las fuentes originales.
- Separa claramente datos observados, suposiciones de negocio y cálculos derivados.
- Evita imputar, excluir o alterar definiciones de negocio silenciosamente.
- Registra filtros aplicados, consultas SQL, scripts de unión (*joins*) y versiones del dataset.

## Evidencia de Finalización
- Conciliación documentada entre filas de entrada y salida.
- Comprobaciones deterministas independientes para métricas y fórmulas clave.
- Unidades de medida, periodos de corte y criterios de redondeo explícitos.
- Salidas reproducibles mediante scripts automatizados desde las fuentes originales.
- Limitaciones de calidad de datos documentadas abiertamente.

## Control de Coste y Contexto
- Procesa grandes volúmenes de datos mediante SQL o código ejecutable en lugar de cargar datos en el contexto del modelo.
- Alimenta al modelo con resúmenes estadísticos, esquemas DDL, muestras pequeñas y excepciones.
- Reserva las llamadas a LLM para interpretación y redacción de conclusiones, no para cálculos aritméticos.
