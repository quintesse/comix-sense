///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.cloud:google-cloud-vision:3.97.0
//JAVA 17

import com.google.cloud.vision.v1.AnnotateImageRequest;
import com.google.cloud.vision.v1.Feature;
import com.google.cloud.vision.v1.Image;
import com.google.cloud.vision.v1.ImageAnnotatorClient;
import com.google.protobuf.ByteString;
import com.google.protobuf.util.JsonFormat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Usage: jbang tools/ocr.java <image-file>
 * Authenticate with Google Application Default Credentials, for example by setting
 * GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON key.
 * Prints the full AnnotateImageResponse as JSON (including text and coordinates).
 */
public class ocr {
    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("Usage: jbang tools/ocr.java <image-file>");
            System.exit(2);
        }

        try {
            var image = Image.newBuilder()
                    .setContent(ByteString.copyFrom(Files.readAllBytes(Path.of(args[0]))))
                    .build();
            var request = AnnotateImageRequest.newBuilder()
                    .setImage(image)
                    .addFeatures(Feature.newBuilder().setType(Feature.Type.TEXT_DETECTION))
                    .build();

            try (var vision = ImageAnnotatorClient.create()) {
                var result = vision.batchAnnotateImages(List.of(request)).getResponses(0);
                var json = JsonFormat.printer().print(result);
                System.out.println(json);
                if (result.hasError()) {
                    throw new IllegalStateException(result.getError().getMessage());
                }
            }
        } catch (Exception e) {
            System.err.println("OCR failed: " + e.getMessage());
            System.exit(1);
        }
    }
}
