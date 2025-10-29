# syntax=docker/dockerfile:1

FROM maven:3.9.6-eclipse-temurin-21 AS build

# Allow Maven to negotiate TLS 1.3 or 1.2 during dependency resolution to
# maximise compatibility with Maven Central and any configured mirrors.
ENV MAVEN_OPTS="-Dhttps.protocols=TLSv1.3,TLSv1.2 -Djdk.tls.client.protocols=TLSv1.3,TLSv1.2"
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/target/hub-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
